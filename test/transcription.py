from .openai_client import client


def transcribe_audio(uploaded_file):
    uploaded_file.seek(0)

    if uploaded_file.size > 25 * 1024 * 1024:
        raise ValueError("File exceeds OpenAI 25MB limit")

    if not uploaded_file.name:
        raise ValueError("Uploaded file has no filename")

    result = client.audio.transcriptions.create(
        model="whisper-1",
        language="sk",
        response_format="verbose_json",
        timestamp_granularities=["word", "segment"],
        file=(
            uploaded_file.name,
            uploaded_file,
            uploaded_file.content_type or "application/octet-stream",
        ),
    )

    words = []
    if getattr(result, "words", None):
        for w in result.words:
            words.append({
                "word": w.word,
                "start": w.start,
                "end": w.end,
            })

    segments = []
    if getattr(result, "segments", None):
        for s in result.segments:
            segments.append({
                "id": getattr(s, "id", None),
                "start": s.start,
                "end": s.end,
                "text": s.text,
            })

    return {
        "text": result.text,
        "words": words,
        "segments": segments,
        "duration": getattr(result, "duration", None),
        "language": getattr(result, "language", "sk"),
    }