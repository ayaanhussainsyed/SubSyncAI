import os
import tempfile
from datetime import timedelta
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory, send_file, Response
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient
import certifi 
from functools import wraps
from openai import OpenAI
from openai import APIError
import json
from dotenv import load_dotenv
from bson.objectid import ObjectId
import re
import datetime
import base64 
import time
import subprocess 
import shutil 
from collections import Counter
from io import BytesIO

load_dotenv() 

MONGO_URI = os.getenv(
    "MONGO_URI",
    "db uri"
)
DB_NAME = os.getenv("DB_NAME", "SubSync")
USERS_COLLECTION = os.getenv("USERS_COLLECTIONS", "user_data")
SECRET_KEY = os.getenv("SECRET_KEY", "change_this_to_a_random_secret_in_prod")

ALLOWED_EXTENSIONS = {'.mov', '.webm', '.mp4', '.mp3', '.wav'} 

def serialize_doc(doc):
    """
    Converts MongoDB ObjectId to string for JSON serialization.
    Also handles datetime objects.
    """
    if doc:
        doc['_id'] = str(doc['_id'])
        if 'user_id' in doc and isinstance(doc['user_id'], ObjectId):
             doc['user_id'] = str(doc['user_id'])
        if 'created_at' in doc and isinstance(doc['created_at'], datetime.datetime):
             doc['created_at'] = doc['created_at'].isoformat()
    return doc

def allowed_file(filename):
    """Checks if the file extension is one of the allowed types (case-insensitive)."""
    if not filename:
        return False
    return os.path.splitext(filename)[1].lower() in ALLOWED_EXTENSIONS

# --- OpenAI Configuration ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY)

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(hours=8)

client_mongo = MongoClient(MONGO_URI, tls=True, tlsCAFile=certifi.where())
db = client_mongo[DB_NAME]
users = db[USERS_COLLECTION]
notes = db['notes'] 

TEMP_FILE_STORAGE = {}


DEFAULT_IDRAK_MODEL = os.getenv("DEFAULT_IDRAK_MODEL", "./model")
def format_timestamp(seconds):
    millis = int((seconds - int(seconds)) * 1000)
    minutes, seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{millis:03}"

def format_srt_timestamp(seconds):
    millis = int((seconds - int(seconds)) * 1000)
    minutes, seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"



def convert_to_mp4(input_path, session_id):
    """
    Converts the input video file to MP4 format (h264/aac) using FFmpeg, 
    but only if the file is a .mov.
    Returns the path and filename of the new MP4 file if converted, 
    or the original path/filename otherwise.
    If conversion succeeds, the original file is removed.
    """
    input_ext = os.path.splitext(input_path)[1].lower()
    

    if input_ext != '.mov':

        print(f"File {os.path.basename(input_path)} is {input_ext}. Conversion to MP4 is not required.")
        return input_path, os.path.basename(input_path) 


    if shutil.which("ffmpeg") is None:
        print("WARNING: FFmpeg not found. Cannot convert .mov video. Proceeding with original file.")
        return input_path, os.path.basename(input_path) 

    print(f"Converting {os.path.basename(input_path)} ({input_ext}) to MP4...")
    
    output_filename = f"{session_id}_converted.mp4"
    output_path = os.path.join(tempfile.gettempdir(), output_filename)
    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-vcodec', 'libx264', 
        '-acodec', 'aac',    
        '-b:v', '2000k',    
        '-pix_fmt', 'yuv420p',
        '-y', output_path
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=600) 
        print(f"Conversion successful. New file: {output_path}")

        os.remove(input_path) 
        
        return output_path, output_filename

    except subprocess.CalledProcessError as e:
        print(f"Error converting video: {e.stderr.decode('utf-8')}")
        print("Conversion failed. Using original file for transcription (will likely fail with mov).")
        return input_path, os.path.basename(input_path) 
    except Exception as e:
        print(f"Conversion failed due to an unexpected error: {e}. Using original file.")
        return input_path, os.path.basename(input_path)


def compress_to_audio_only(input_path, session_id):
    """
    Extracts only the audio stream and aggressively compresses it to MP3 at a low bitrate (64k)
    to ensure the file is under the OpenAI 25MB limit.
    Returns the path to the compressed audio file, or the original path on failure.
    """
    temp_dir = tempfile.gettempdir()
    audio_filename = f"{session_id}_audio_64k.mp3"
    audio_path = os.path.join(temp_dir, audio_filename)
    
    # Check for FFmpeg availability
    if shutil.which("ffmpeg") is None:
        print("WARNING: FFmpeg not found. Cannot compress audio. Proceeding with original file.")
        return input_path
        
    print(f"Compressing {os.path.basename(input_path)} to 64k MP3 for transcription...")

    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-vn', 
        '-map', '0:a:0', 
        '-c:a', 'libmp3lame', 
        '-b:a', '64k',
        '-y', audio_path
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=300) 
        file_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        if file_size_mb > 25:
             print(f"WARNING: Compressed file is still {file_size_mb:.2f}MB, exceeding 25MB limit. Using original path on fallback.")
             return input_path
             
        print(f"Compression successful. Audio-only file size: {file_size_mb:.2f}MB.")
        return audio_path
        
    except subprocess.CalledProcessError as e:
        print(f"Error compressing file to audio-only: {e.stderr.decode('utf-8')}")
        return input_path



def get_llm_emotion_prediction(text):
    EMOTIONS = ["Love", "Surprise", "Anger", "Fear", "Joy", "Sadness", "Neutral"] 
    prompt = (
        f"Analyze the following text segment and classify the primary emotion into one of these categories: {', '.join(EMOTIONS)}. "
        f"If the emotion is unclear, choose 'Neutral'. "
        f"ONLY output a single JSON object with the key 'emotion' and the classified emotion as its value. "
        f"Text segment: \"{text}\""
    )
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": f"You are an expert emotion analysis AI. You must respond ONLY with a single JSON object containing the key 'emotion'. The emotion must be one of: {', '.join(EMOTIONS)}."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        json_response = json.loads(completion.choices[0].message.content)
        predicted_emotion = json_response.get("emotion", "Neutral").strip()
        
        for valid_emotion in EMOTIONS:
            if predicted_emotion.lower() == valid_emotion.lower():
                return valid_emotion
                
        return "Neutral"
        
    except Exception as e:
        print(f"Error during LLM emotion prediction for text '{text}': {e}")
        return "Neutral" 


def perform_semantic_search(segments, query):
    """
    Uses an LLM to analyze transcript segments and find the top 3 most relevant segments 
    based on the user's query, including a calculated relevance score.
    """
    if not segments:
        return []

    formatted_segments = []
    for i, s in enumerate(segments):
        formatted_segments.append({
            "id": i,
            "start_time": s['start'],
            "speaker": s.get('speaker', 'Unknown'),
            "text": s['text'].strip()
        })
    
    segments_json = json.dumps(formatted_segments, indent=2)

    prompt = (
        f"You are a highly accurate semantic search AI. Your goal is to find the transcript segments most relevant to the user's query. "
        f"Analyze the following list of segments and identify the TOP 3 segments that are most semantically similar or contextually related to the query: \"{query}\". "
        f"For each of the top 3 results, you must calculate a 'relevance' score (a float between 0.0 and 1.0, where 1.0 is a perfect match and 0.0 is not relevant). "
        f"Return ONLY a single JSON object with the key 'results' which is an array of the selected segments, including their 'start_time', 'speaker', 'text', and the calculated 'relevance' score. "
        f"Segments list (JSON array):\n{segments_json}"
    )

    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a specialized semantic search engine for transcript analysis. You must analyze the provided segments against the user query and return ONLY a JSON object containing the key 'results' with a list of up to 3 objects, each having 'start_time', 'speaker', 'text', and 'relevance' (float 0.0-1.0)."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        json_response = json.loads(completion.choices[0].message.content)
        results = json_response.get("results", [])
        
        # Sort by relevance and ensure clean output structure
        results.sort(key=lambda x: x.get('relevance', 0.0), reverse=True)
        
        # Clean up the output structure and ensure float conversion
        cleaned_results = []
        for r in results:
            if 'start_time' in r and 'text' in r:
                 cleaned_results.append({
                     'start_time': float(r['start_time']),
                     'speaker': r.get('speaker', 'Unknown'),
                     'text': r['text'],
                     'relevance': float(r.get('relevance', 0.0))
                 })

        return cleaned_results[:3] # Ensure only top 3 are returned
        
    except Exception as e:
        print(f"Error during LLM semantic search for query '{query}': {e}")
        return []
# --- END NEW LLM-based Semantic Search Helper ---

def generate_semantic_map(summary, tags):
    """
    Generates a semantic map (knowledge graph) structure based on the summary and tags.
    This function uses the LLM to output a JSON string, which must be parsed correctly.
    """
    if not OPENAI_API_KEY:
        print("OPENAI_API_KEY not set. Cannot run LLM map generation.")
        return None

    # Define the expected JSON format for the LLM prompt
    json_format = {
        "nodes": [
            {"id": "Concept A", "label": "Concept A"},
            {"id": "Concept B", "label": "Concept B"}
        ],
        "edges": [
            {"source": "Concept A", "target": "Concept B", "relationship": "IS_RELATED_TO"}
        ]
    }
    
    prompt = f"""
    You are an expert knowledge graph generator. Based on the video summary and key tags provided below, 
    generate a cognitive map structure containing nodes (key concepts) and edges (relationships).
    
    **Summary:** {summary}
    **Tags:** {', '.join(tags)}
    
    The output MUST be a valid JSON object matching this schema exactly: {json.dumps(json_format, indent=2)}.
    Do not include any additional text, explanation, or markdown formatting (e.g., ```json) outside of the JSON object.
    """
    
    try:
        client = OpenAI(api_key=OPENAI_API_KEY)
        response = client.chat.completions.create(
            model="gpt-3.5-turbo-1106", 
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        
        raw_output = response.choices[0].message.content.strip()
        print(f"LLM Raw Output:\n{raw_output[:200]}...")

        try:
            map_data = json.loads(raw_output)
            # Basic validation check
            if 'nodes' in map_data and 'edges' in map_data:
                return map_data
        except json.JSONDecodeError:
            print("Direct JSON parse failed. Attempting regex cleanup...")
            
            match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```|(\{[\s\S]*?\})', raw_output, re.DOTALL)
            
            if match:
                # Use the matched group that is not None
                json_string = match.group(1) or match.group(2)
                
                try:
                    # Final attempt to load the cleaned string
                    map_data = json.loads(json_string)
                    print("Successfully parsed JSON after regex cleanup.")
                    return map_data
                except json.JSONDecodeError as e:
                    print(f"Final JSON parse failed even after regex cleanup: {e}")
                    raise ValueError("The string did not match the expected pattern after cleanup.")

            else:
                # 3. If no JSON structure is found, raise an error
                print("Could not find a parsable JSON structure in the LLM response.")
                raise ValueError("The string did not match the expected pattern.")

    except APIError as e:
        print(f"OpenAI API Error: {e}")
        return None
    except ValueError as e:
        # Re-raise the parsing error for the route to catch and report
        raise e
    except Exception as e:
        print(f"Error during semantic map generation: {e}")
        return None
# --- Study Mode Helpers (EXISTING) ---

def extract_and_encode_frames(media_path, num_frames=5):
    """
    Uses FFmpeg (via subprocess) to extract frames from the media file, 
    resizes them (to speed up LLM analysis), and encodes them to base64.
    """
    
    # 1. Check if the file is a video format (audio files are excluded)
    if os.path.splitext(media_path)[1].lower() in ['.mp3', '.wav']:
        print(f"Study Mode: Audio file detected. Skipping frame extraction.")
        return []

    # 2. Check for FFmpeg availability
    if shutil.which("ffmpeg") is None:
        print("ERROR: FFmpeg not found on system path. Cannot extract video frames.")
        return []

    print(f"Study Mode: Attempting to extract {num_frames} frames from video...")
    
    frames_base64 = []
    
    # Get video duration using ffprobe or ffmpeg, fall back to a default if necessary
    duration = 0
    try:
        cmd_duration = [
            'ffprobe', 
            '-v', 'error', 
            '-show_entries', 'format=duration', 
            '-of', 'default=noprint_wrappers=1:nokey=1', 
            media_path
        ]
        duration_output = subprocess.check_output(cmd_duration, stderr=subprocess.STDOUT).decode('utf-8').strip()
        duration = float(duration_output)
    except Exception as e:
        print(f"Warning: Could not determine video duration with ffprobe. Using 30 seconds as default. Error: {e}")
        duration = 30 
    
    if duration < 1:
        print("Video duration too short for frame extraction.")
        return []

    # Calculate time points for frame extraction (evenly distributed)
    time_points = [duration * (i + 1) / (num_frames + 1) for i in range(num_frames)]
    
    # Use a temporary directory for output frames
    with tempfile.TemporaryDirectory() as temp_dir:
        for i, timestamp in enumerate(time_points):
            output_path = os.path.join(temp_dir, f"frame_{i}.jpg")
            
            # FFmpeg command: seek to timestamp, extract 1 frame, resize to 768px wide (for speed/cost), save as jpeg
            cmd_frame = [
                'ffmpeg',
                '-ss', str(timestamp), 
                '-i', media_path,
                '-vframes', '1',
                '-vf', 'scale=768:-1', # Resize filter
                '-q:v', '5', # Low quality JPEG for small file size
                '-y', output_path
            ]
            
            try:
                subprocess.run(cmd_frame, check=True, capture_output=True, timeout=10)
                
                # Encode the frame to base64
                with open(output_path, "rb") as image_file:
                    base64_encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
                    frames_base64.append(base64_encoded_image)
                    
            except subprocess.CalledProcessError as e:
                print(f"Error extracting frame at {timestamp}s: {e.stderr.decode('utf-8')}")
                continue # Try the next frame
            except Exception as e:
                print(f"Error processing frame: {e}")
                continue
    
    print(f"Successfully extracted and encoded {len(frames_base64)} frames.")
    return frames_base64


def generate_study_summary_and_tags(transcript, visual_context_images):
    """
    Uses GPT-4o (multimodal) to generate a summary and tags based on transcript and visuals.
    """
    # Determine the model and visual prompt based on the presence of images
    if not visual_context_images:
        model = "gpt-4o-mini"
        visual_prompt = "No visual context available. Base the analysis solely on the transcript."
    else:
        model = "gpt-4o" # Use gpt-4o for multimodal capability
        visual_prompt = f"{len(visual_context_images)} key frames from the video are provided. Integrate visual information with the audio transcript."
    
    # Base messages for the LLM
    messages = [
        {"role": "system", "content": "You are an expert study note generator. Your task is to analyze the provided transcript and visual context to generate a concise summary and a list of key topic tags. You must respond ONLY with a single JSON object."},
        {"role": "user", "content": [
            {"type": "text", "text": "Analyze the following conversation and visual context to generate a summary (max 3 sentences) and 5 key topic tags. "
                                     "Focus on connecting the spoken content with what is visible. "
                                     f"Visual context instruction: {visual_prompt}"},
            {"type": "text", "text": f"--- FULL TRANSCRIPT ---\n{transcript}"}
        ]}
    ]
    
    # Append image data to the user message if available
    for img_base64 in visual_context_images:
        messages[1]["content"].append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{img_base64}",
                "detail": "low"
            }
        })

    # Append JSON schema instruction
    messages[1]["content"].append({"type": "text", "text": "JSON schema: {\"summary\": \"<summary text>\", \"tags\": [\"tag1\", \"tag2\", \"tag3\", \"tag4\", \"tag5\"]}"})

    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"}
        )
        
        json_response = json.loads(completion.choices[0].message.content)
        return {
            "summary": json_response.get("summary", "Could not generate summary."),
            "tags": json_response.get("tags", ["Error", "AI_Failure"])
        }
        
    except Exception as e:
        print(f"Error during LLM study generation: {e}")
        return {
            "summary": f"Study analysis failed due to an API or server error: {e}. (Using {model} model).",
            "tags": ["Analysis_Failed", "Check_API"]
        }

def generate_study_title(summary, tags):
    """
    Uses an LLM to generate a concise and appropriate title for the study notes.
    """
    tags_str = ", ".join(tags)
    prompt = (
        f"Generate a concise and appropriate title (max 8 words) for a study note based on the following summary and key topics. "
        f"Summary: \"{summary}\" "
        f"Key Topics: {tags_str}. "
        f"Respond ONLY with the title text."
    )
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a professional title generator. Your response must be a single, concise title (max 8 words)."},
                {"role": "user", "content": prompt}
            ]
        )
        return completion.choices[0].message.content.strip().replace('"', '')
        
    except Exception as e:
        print(f"Error during LLM title generation: {e}")
        return "Untitled Study Notes"
# --- END Study Mode Helpers ---


def get_overall_emotion(segments):
    if not segments:
        return "Neutral"
    emotions = [segment.get('emotion', 'Neutral') for segment in segments]
    emotion_counts = Counter(emotions)
    most_common = emotion_counts.most_common(1)
    if most_common:
        return most_common[0][0]
    return "Neutral"

# --- Speaker Diarization Function (EXISTING) ---
def add_speaker_diarization(segments):
    if not segments:
        return []
        
    # Prepare text for LLM, including start/end times
    text_for_llm = "\n".join([f"[{s['start']:.2f}-{s['end']:.2f}]: {s['text'].strip()}" for s in segments])
    
    # Initial default speaker assignment
    for segment in segments:
        segment['speaker'] = "Speaker 1" # Default label
        
    prompt = (
        "The following is a list of time-stamped text segments from a conversation. "
        "Analyze the content (especially tone and context) to accurately determine speaker changes and assign a label ('Speaker 1', 'Speaker 2', etc.) to each segment. "
        "Maintain the original text, start, and end values. "
        "Return ONLY a single JSON object containing a key 'diarized_segments' which is an array of objects. "
        "Each object must ONLY have keys 'text', 'start', 'end', and 'speaker'. "
        "The number of objects in the array MUST match the number of input segments. "
        "Here are the segments:\n\n" + text_for_llm
    )
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert speaker diarization AI that analyzes conversation transcripts. Your response must be a single JSON object with the key 'diarized_segments' containing a list of objects, each having 'text', 'start', 'end', and 'speaker' keys. DO NOT add any extra text or markdown outside the JSON object."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        json_response = json.loads(completion.choices[0].message.content)
        diarized_segments_list = json_response.get("diarized_segments")
        
        if isinstance(diarized_segments_list, list) and len(diarized_segments_list) == len(segments):
            # Success: Update the speaker labels in the original segments array
            for i, original_segment in enumerate(segments):
                llm_speaker = diarized_segments_list[i].get('speaker')
                if llm_speaker:
                    # Update speaker label from LLM response
                    original_segment['speaker'] = llm_speaker
            print("Speaker diarization successfully applied from LLM response.")
        else:
            # Added more descriptive error
            print(f"Diarization response invalid. Expected {len(segments)} segments in 'diarized_segments' array, got {len(diarized_segments_list) if isinstance(diarized_segments_list, list) else 'non-list'}. Using default 'Speaker 1'.")
        
    except Exception as e:
        # This catches API errors and JSON parsing errors
        print(f"Diarization failed ({e}). Retaining default 'Speaker 1' labels.")

    return segments


def create_vtt_from_segments(segments):
    vtt_content = "WEBVTT\n\n"
    for i, segment in enumerate(segments):
        start_time = format_timestamp(segment['start'])
        end_time = format_timestamp(segment['end'])
        text = segment['text'].strip()
        speaker = segment.get('speaker', 'SPEAKER') 
        speaker_tag = speaker.replace(" ", "_").upper()
        vtt_content += f"{i+1}\n"
        vtt_content += f"{start_time} --> {end_time}\n"
        vtt_content += f"<v {speaker_tag}>{text}</v>\n\n"
    return vtt_content

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

def find_user_by_username(username):
    if not username:
        return None
    return users.find_one({"username": username})

@app.route('/download-srt', methods=['POST'])
def download_srt():
    """
    Expects JSON: { "segments": [ { "start": float, "end": float, "speaker": str, "text": str }, ... ],
                    "filename": "transcript.srt" }
    Returns: SRT file as attachment
    """
    data = request.get_json(force=True, silent=True)
    if not data or 'segments' not in data:
        return jsonify({"error": "No segments provided"}), 400

    segments = data['segments']
    filename = data.get('filename', 'transcript.srt')

    def seconds_to_srt(t):
        total_ms = int(round(t * 1000))
        hours = total_ms // 3600000
        minutes = (total_ms % 3600000) // 60000
        seconds = (total_ms % 60000) // 1000
        ms = total_ms % 1000
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"

    srt_lines = []
    for i, seg in enumerate(segments, start=1):
        start = seconds_to_srt(float(seg.get('start', 0.0)))
        end = seconds_to_srt(float(seg.get('end', seg.get('start', 0.0) + 2)))
        speaker = seg.get('speaker', '')
        text = (seg.get('text', '') or '').replace('\r\n', ' ').replace('\n', ' ')
        line = f"{i}\n{start} --> {end}\n{(speaker + ': ') if speaker else ''}{text}\n"
        srt_lines.append(line)

    srt_content = "\n".join(srt_lines)
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"',
        'Content-Type': 'text/plain; charset=utf-8'
    }
    return Response(srt_content, headers=headers)


@app.route("/")
def index():
    if "user_id" in session:
        return redirect(url_for("home"))
    return redirect(url_for("login"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = find_user_by_username(username)
        
        if user and check_password_hash(user["password_hash"], password):
            session.permanent = True
            session["user_id"] = str(user["_id"])
            session["username"] = user["username"]
            return redirect(url_for("home"))
        
        return render_template("login.html", error="Invalid username or password.")
    return render_template("login.html")

@app.route("/sign-up", methods=["GET", "POST"])
def sign_up():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            return render_template("sign-up.html", error="Please provide username and password.")

        if users.find_one({"username": username}):
            return render_template("sign-up.html", error="Username already taken.")

        password_hash = generate_password_hash(password)
        doc = {
            "username": username,
            "password_hash": password_hash,
            "created_at": __import__("datetime").datetime.utcnow()
        }
        result = users.insert_one(doc)

        session.permanent = True
        session["user_id"] = str(result.inserted_id)
        session["username"] = username
        return redirect(url_for("home"))
    return render_template("sign-up.html")


@app.route("/home")
@login_required
def home():
    username = session.get("username")
    return render_template("home.html")

@app.route('/caption-ai')
@login_required
def caption():
    return render_template("caption.html")

@app.route("/logout")
def logout():
    session_id = session.get("user_id")
    if session_id in TEMP_FILE_STORAGE:
        media_file_path = TEMP_FILE_STORAGE[session_id].get("path")
        if media_file_path and os.path.exists(media_file_path):
            os.remove(media_file_path)
        vtt_file_path = TEMP_FILE_STORAGE[session_id].get("vtt_path")
        if vtt_file_path and os.path.exists(vtt_file_path):
            os.remove(vtt_file_path)
            
        del TEMP_FILE_STORAGE[session_id]
        
    session.clear()
    return redirect(url_for("login"))


@app.route('/media/<filename>')
@login_required
def serve_media(filename):
    session_id = session.get("user_id")
    file_info = TEMP_FILE_STORAGE.get(session_id)
    
    # Check if the requested filename matches the media file's temp_name or the VTT file's name
    if file_info and (file_info.get("temp_name") == filename or os.path.basename(file_info.get("vtt_path")) == filename):
        
        # Determine the full path of the file to serve
        file_to_serve_path = file_info.get("path") if file_info.get("temp_name") == filename else file_info.get("vtt_path")
        
        if os.path.exists(file_to_serve_path):
            return send_from_directory(
                os.path.dirname(file_to_serve_path), 
                filename,
                as_attachment=False
            )
    return "File not found or unauthorized.", 404

@app.route('/get-emotion-chart-data', methods=['GET'])
@login_required
def get_emotion_chart_data():
    session_id = session.get("user_id")
    file_info = TEMP_FILE_STORAGE.get(session_id)
    
    if not file_info or not file_info.get('segments'):
        return jsonify({"error": "No segment data found. Please upload and process media first."}), 400

    segments = file_info['segments']
    overall_emotion = get_overall_emotion(segments)
    
    return jsonify({
        "success": True,
        "overall_emotion": overall_emotion,
        "segments": segments
    })


# ---------- Transcription Route (CAPTION MODE) ----------

@app.route('/upload-audio', methods=['POST'])
@login_required
def upload_audio():
    if 'audioFile' not in request.files:
        return jsonify({"error": "No file part in the request."}), 400

    audio_file = request.files['audioFile']
    
    if audio_file.filename == '':
        return jsonify({"error": "No selected file."}), 400

    if not allowed_file(audio_file.filename):
        allowed_list = ', '.join(sorted([ext.strip('.').upper() for ext in ALLOWED_EXTENSIONS]))
        return jsonify({
            "error": f"Unsupported file format. Please upload a file with one of the following extensions: {allowed_list}"
        }), 400

    session_id = session.get("user_id")
    original_filename = audio_file.filename
    file_extension = os.path.splitext(original_filename)[1]
    
    # Clean up old file storage (omitted for brevity, assume functional)
    if session_id in TEMP_FILE_STORAGE:
        pass 
    
    try:
        # 1. Save the Media File temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension, prefix=session_id + '_media_') as tmp_media_file:
            audio_file.save(tmp_media_file.name)
            temp_media_file_path = tmp_media_file.name

        # 2. Convert to MP4 if necessary (for .mov only)
        # media_path_for_processing will be the path to the converted MP4 or the original file.
        # media_name_for_serving will be the filename used in the URL.
        media_path_for_processing, media_name_for_serving = convert_to_mp4(
            input_path=temp_media_file_path,
            session_id=session_id
        )
        
        # 3. AGGRESSIVELY COMPRESS AUDIO for Whisper API size limit
        # This creates a small, audio-only file for transcription
        transcription_path = compress_to_audio_only(
            input_path=media_path_for_processing, 
            session_id=session_id
        )
        
        # 4. Transcribe (Whisper API) using the compressed audio file
        with open(transcription_path, "rb") as media_data:
            transcript_response = client.audio.transcriptions.create(
                model="whisper-1", 
                file=media_data, # <--- Uses the SMALLER, compressed audio file
                response_format="verbose_json"
            )
            
        full_transcript_data = transcript_response.model_dump()
        segments = full_transcript_data.get("segments", [])
        
        # 5. Cleanup the temporary compressed audio file
        # Only delete the temporary audio-only file if it was successfully created 
        if transcription_path != media_path_for_processing and os.path.exists(transcription_path):
            os.remove(transcription_path)
            
        # 6. Add Speaker Diarization (LLM: GPT-4o-mini)
        segments_with_speakers = add_speaker_diarization(segments) 
        
        # 7. Add Emotion Prediction (SEGMENT-LEVEL)
        for segment in segments_with_speakers:
            segment['emotion'] = get_llm_emotion_prediction(segment['text'])

        full_transcript_data["segments"] = segments_with_speakers
        
        # 8. Create WebVTT file
        vtt_content = create_vtt_from_segments(segments_with_speakers)
        vtt_filename = f"{session_id}_subtitles.vtt"
        vtt_temp_dir = tempfile.gettempdir()
        temp_vtt_file_path = os.path.join(vtt_temp_dir, vtt_filename)
        with open(temp_vtt_file_path, "w", encoding="utf-8") as vtt_file:
            vtt_file.write(vtt_content)

        # 9. STORE SEGMENTS IN TEMP_FILE_STORAGE
        TEMP_FILE_STORAGE[session_id] = {
            "path": media_path_for_processing, # Path of the file used for processing (MP4 if converted)
            "filename": original_filename,
            "temp_name": media_name_for_serving, # Filename used for serving the media via URL
            "vtt_path": temp_vtt_file_path,
            "vtt_name": vtt_filename,
            "segments": segments_with_speakers,
            "study_notes": None 
        }
        
        # 10. Return the results
        return jsonify({
            "success": True,
            "transcript_data": full_transcript_data, 
            "media_url": url_for('serve_media', filename=media_name_for_serving),
            "vtt_url": url_for('serve_media', filename=vtt_filename)
        })

    except APIError as api_error:
        error_message = f"OpenAI API Error: {api_error.response.status_code} - {api_error.response.json().get('error', {}).get('message', 'Unknown API error.')}"
        print(f"Processing Error: {error_message}")
        
        # Ensure cleanup of the original file path on API error
        if os.path.exists(temp_media_file_path):
            os.remove(temp_media_file_path)
            
        return jsonify({"error": error_message}), 400
    except Exception as e:
        error_message = f"Internal Server Error: {e}"
        print(f"Processing Error: {e}")
        return jsonify({"error": f"An unexpected error occurred during processing. Please check the file and try again. ({error_message}) "}), 500


# --- NEW ROUTE: Semantic Search ---
@app.route('/semantic-search', methods=['POST'])
@login_required
def semantic_search():
    session_id = session.get("user_id")
    file_info = TEMP_FILE_STORAGE.get(session_id)
    data = request.get_json()
    query = data.get("query", "").strip()

    if not query:
        return jsonify({"error": "Search query cannot be empty."}), 400

    if not file_info or not file_info.get('segments'):
        return jsonify({"error": "No transcript data found. Please run 'Caption Mode' first."}), 400

    segments = file_info['segments']
    
    try:
        # Perform the LLM-based semantic search
        search_results = perform_semantic_search(segments, query)
        
        return jsonify({
            "success": True,
            "query": query,
            "results": search_results
        })
    
    except Exception as e:
        error_message = f"An unexpected error occurred during semantic search: {e}"
        print(error_message)
        return jsonify({"error": error_message}), 500
# --- END NEW ROUTE ---


# --- NEW ROUTE: Study Mode Processing (EXISTING) ---
@app.route('/process-study-mode', methods=['POST'])
@login_required
def process_study_mode():
    session_id = session.get("user_id")
    file_info = TEMP_FILE_STORAGE.get(session_id)

    if not file_info or not file_info.get('path'):
        return jsonify({"error": "No media file found. Please upload a file first."}), 400

    media_path = file_info['path']
    segments = file_info.get('segments')
    
    if not segments:
        return jsonify({"error": "Transcript data is missing. Please run 'Caption Mode' first."}), 400
    
    try:
        # 1. Prepare Full Transcript
        full_transcript = " ".join([s['text'] for s in segments])

        # 2. Extract Visual Context (ACTUAL IMPLEMENTATION)
        visual_context_images = extract_and_encode_frames(media_path)
        
        # 3. Generate Summary and Tags using Multimodal LLM
        # Pass the full list of base64 encoded images to the LLM helper
        study_notes = generate_study_summary_and_tags(full_transcript, visual_context_images)

        # 4. Store and Return Results
        TEMP_FILE_STORAGE[session_id]['study_notes'] = study_notes
        
        return jsonify({
            "success": True,
            "study_notes": study_notes
        })
    except Exception as e:
        error_message = f"An unexpected error occurred during Study Mode processing: {e}"
        print(error_message)
        return jsonify({"error": error_message}), 500

# --- NEW ROUTE: Save Notes to Database (EXISTING) ---
@app.route('/save-study-notes', methods=['POST'])
@login_required
def save_study_notes():
    session_id = session.get("user_id")
    file_info = TEMP_FILE_STORAGE.get(session_id)

    if not file_info or not file_info.get('study_notes'):
        return jsonify({"error": "No study notes found to save. Please run Study Mode first."}), 400

    study_notes = file_info['study_notes']
    user_id = session.get("user_id") 
    
    try:
        # 1. Generate an appropriate title using LLM
        summary = study_notes['summary']
        tags = study_notes['tags']
        title = generate_study_title(summary, tags)
        
        # 2. Prepare document for MongoDB
        note_document = {
            "user_id": ObjectId(user_id), # Ensure the user_id is saved as an ObjectId
            "title": title,
            "original_filename": file_info['filename'],
            "summary": summary,
            "tags": tags,
            "created_at": __import__("datetime").datetime.utcnow()
        }

        # 3. Save to database (using the new 'notes' collection)
        result = notes.insert_one(note_document)
        
        return jsonify({
            "success": True,
            "message": "Study notes saved successfully!",
            "note_id": str(result.inserted_id),
            "generated_title": title
        })
        
    except Exception as e:
        print(f"Error saving study notes: {e}")
        return jsonify({"error": f"Failed to save notes: {e}"}), 500

# Existing routes...

@app.route("/notes")
@login_required
def notes_page():
    # The notes page will now fetch data via AJAX
    return render_template("notes.html")

# NEW API Route to fetch all notes for the current user
@app.route("/api/notes", methods=["GET"])
@login_required
def get_user_notes():
    user_id = session.get("user_id")
    
    try:
        # The user ID is stored in session as a string, convert it to ObjectId for querying
        user_obj_id = ObjectId(user_id)
    except Exception:
        # Should not happen if user_id is properly managed during login/signup
        return jsonify({"error": "Invalid user ID format"}), 400

    try:
        # Fetch all notes for the user, sorted by creation date descending
        # The summary field holds the full HTML content of the note
        notes_cursor = notes.find({"user_id": user_obj_id}).sort("created_at", -1)
        
        # Convert cursor to a list of serialized documents
        note_list = [serialize_doc(doc) for doc in notes_cursor]
        
        return jsonify({"notes": note_list})

    except Exception as e:
        print(f"Error fetching notes: {e}")
        return jsonify({"error": "Failed to retrieve notes"}), 500


@app.route("/api/notes/<note_id>", methods=["PATCH"])
@login_required
def update_note(note_id):
    """Updates the title and summary content of a specific note."""
    user_id = session.get("user_id")
    data = request.get_json()
    new_title = data.get("title", "").strip()
    new_summary = data.get("summary", "").strip()

    if not new_title or not new_summary:
        return jsonify({"error": "Title and summary are required fields."}), 400

    try:
        note_obj_id = ObjectId(note_id)
        user_obj_id = ObjectId(user_id)
    except Exception:
        return jsonify({"error": "Invalid ID format."}), 400

    try:
        # Update the note, ensuring it belongs to the logged-in user for security
        result = notes.update_one(
            {"_id": note_obj_id, "user_id": user_obj_id},
            {
                "$set": {
                    "title": new_title,
                    "summary": new_summary, # Save the HTML content
                    "modified_at": datetime.datetime.utcnow() # Update the modification timestamp
                }
            }
        )
        
        if result.matched_count == 0:
            return jsonify({"error": "Note not found or access denied."}), 404
            
        # Return success even if no fields changed, as the PATCH was processed
        return jsonify({"success": True, "message": "Note updated successfully."})

    except Exception as e:
        print(f"Error updating note {note_id}: {e}")
        return jsonify({"error": f"Failed to update note: {e}"}), 500

####



@app.route('/get-cognitive-map', methods=['GET'])
@login_required
def get_cognitive_map():
    session_id = session.get('user_id')
    session_data = TEMP_FILE_STORAGE.get(session_id)
    
    if not session_data:
        return jsonify({"error": "Session data not found. Please run Caption Mode first."}), 400
        
    study_notes = session_data.get('study_notes', {})
    
    summary = study_notes.get('summary')
    tags = study_notes.get('tags')
    
    # Check if summary and tags have been generated
    if not summary or not tags or not isinstance(tags, list) or len(tags) == 0:
        return jsonify({"error": "Summary and tags must be generated in Study Mode first."}), 400
        
    print(f"Generating semantic map for {len(tags)} tags...")
    
    try:
        # Attempt to use cached map data first
        cached_map = session_data.get('cognitive_map_data')
        if cached_map:
            print("Returning cached cognitive map data.")
            return jsonify({"success": True, "map_data": cached_map})


        map_data = generate_semantic_map(summary, tags)
        
        if not map_data:
            return jsonify({"error": "LLM failed to produce a valid map structure."}), 500

        # Cache the map data
        TEMP_FILE_STORAGE[session_id]['cognitive_map_data'] = map_data

        return jsonify({"success": True, "map_data": map_data})

    except ValueError as e:
        # This catches the specific parsing error from generate_semantic_map
        print(f"Map Generation Error: {e}")
        return jsonify({"error": f"Map Generation Error: {e}"}), 500
    except Exception as e:
        print(f"Server error during cognitive map generation: {e}")
        return jsonify({"error": f"Internal server error: {e}"}), 500


if __name__ == "__main__":
    if not OPENAI_API_KEY:
        print("\n!!! WARNING: OPENAI_API_KEY is NOT set. AI features will fail. !!!\n")
        
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 7746)), debug=True)
