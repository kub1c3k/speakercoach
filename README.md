# SpeakerCoach (TEMPORARILY UNAVAILABLE)

> 75% of people fear public speaking. SpeakerCoach lets you practice and get objective feedback — no audience, no judgment, just raw data.

## What it does

You open the app, calibrate your camera to your face, then speak naturally while SpeakerCoach analyzes your performance in real time. When you stop, you get a full breakdown of your session.

**Eye contact** — MediaPipe FaceMesh tracks 468 facial landmarks to classify your gaze direction (left, right, center, up, down) against your personal calibration baseline. Because every face and camera position is different, calibration creates a model specific to you rather than a generic average.

**Speech analysis** — your audio is sent to OpenAI Whisper which returns a full transcription with timestamps. From this, SpeakerCoach detects filler words and long pauses, showing you exactly where your speech breaks down.

All sessions are saved so you can track improvement over time.

## Tech stack

- **Backend** — Django, Python
- **Database** — PostgreSQL
- **Cache** — Redis
- **Computer vision** — MediaPipe FaceMesh
- **Speech recognition** — OpenAI Whisper API
- **Frontend** — HTML, CSS, JavaScript, Tailwind CSS
- **Auth** — Django authentication system

## Screenshots

*coming soon*

## Running locally

### Requirements
- Python 3.10+
- Node.js
- PostgreSQL
- Redis
- OpenAI API key

### Setup

```bash
git clone https://github.com/kub1c3k/speakercoach
cd speakercoach
pip install -r requirements.txt
npm install
```

Create a `.env` file in the root:

```
SECRET_KEY=your_django_secret_key
OPENAI_API_KEY=your_openai_key
DATABASE_URL=your_postgres_url
REDIS_URL=your_redis_url
```

Run migrations and start:

```bash
python manage.py migrate
python manage.py runserver
```

## Known limitations

- Calibration requires the user to follow on-screen instructions carefully — incorrect calibration affects gaze accuracy
- Whisper transcription is not always perfect, especially with background noise
- Gaze detection can be inconsistent in low light conditions

## What I'd improve next

- Guided calibration with visual feedback so users can't miscalibrate
- Local Whisper model option to reduce API costs and latency
- Trend graphs across sessions to visualize improvement over time
- Mobile support
