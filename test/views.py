from django.shortcuts import render
from django.http import JsonResponse
import json
from accounts.models import Score
from django.utils import timezone
from django.contrib.auth.decorators import login_required
from .transcription import transcribe_audio
from django.views.decorators.csrf import csrf_exempt
from django_ratelimit.decorators import ratelimit
from .transcription import transcribe_audio
from django.core.paginator import Paginator
from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.http import require_POST


def testView(request):
    return render(request, "test/test.html")



def home(request):
    return render(request, 'index.html')



@login_required
def history_page(request):
    scores = Score.objects.filter(user=request.user).order_by("-date")

    search_id = request.GET.get("id", "").strip()

    if search_id:
        if search_id.isdigit():
            scores = scores.filter(id=int(search_id))
        else:
            scores = scores.none()

    paginator = Paginator(scores, 5)  # 5 výsledkov na stránku
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)

    return render(request, "test/history.html", {
        "page_obj": page_obj,
        "search_id": search_id,
    })

@login_required
@require_POST
def save_session(request):
    try:
        data = json.loads(request.body)

        gaze_data = data.get("gaze", {})
        speech_data = data.get("speech", {})
        duration_ms = data.get("duration_ms", 0)
        transcript = data.get("transcript", "")
        analysis = data.get("analysis", "")
        long_pauses = data.get("longPauses", [])
        raw_metrics = data.get("rawMetrics", {})

        if not isinstance(gaze_data, dict) or not isinstance(speech_data, dict):
            return JsonResponse(
                {"status": "error", "message": "Invalid 'gaze' or 'speech' format"},
                status=400
            )

        duration_seconds = max(0, round(duration_ms / 1000)) if duration_ms else 0

        score = Score.objects.create(
            user=request.user,
            duration_seconds=duration_seconds,

            eye_contact_percentage=float(gaze_data.get("CENTER", 0) * 100),
            left_percentage=float(gaze_data.get("LEFT", 0) * 100),
            right_percentage=float(gaze_data.get("RIGHT", 0) * 100),
            up_percentage=float(gaze_data.get("UP", 0) * 100),
            down_percentage=float(gaze_data.get("DOWN", 0) * 100),

            total_words=int(speech_data.get("totalWords", 0)),
            tempo_wpm=int(speech_data.get("tempoWPM", 0)),
            filler_count=int(speech_data.get("fillerCount", 0)),
            pause_count=int(speech_data.get("pauseCount", 0)),
            filler_ratio=float(speech_data.get("fillerRatio", 0)),

            transcript=transcript or "",
            analysis=analysis or "",

            long_pauses=long_pauses if isinstance(long_pauses, list) else [],
            raw_metrics=raw_metrics if isinstance(raw_metrics, dict) else {},
        )

        return JsonResponse({
            "status": "success",
            "score_id": score.id
        })

    except json.JSONDecodeError:
        return JsonResponse(
            {"status": "error", "message": "Invalid JSON"},
            status=400
        )
    except Exception as e:
        return JsonResponse(
            {"status": "error", "message": str(e)},
            status=500
        )

@csrf_exempt
@ratelimit(key="ip", rate="10/m", method="POST", block=True)
def transcribe_view(request):
    if request.method != "POST":
        return JsonResponse({"error": "Povolený je len POST"}, status=405)

    audio_file = request.FILES.get("file")

    if not audio_file:
        return JsonResponse({"error": "Chýba súbor s názvom 'file'"}, status=400)

    try:
        result = transcribe_audio(audio_file)
        pause_data = compute_pauses_from_words(result.get("words", []), threshold=1.2)

        return JsonResponse({
            "text": result["text"],
            "words": result["words"],
            "segments": result["segments"],
            "duration": result["duration"],
            "language": result["language"],
            "pause_count": pause_data["pause_count"],
            "long_pauses": pause_data["long_pauses"],
        })
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

def ratelimited_error(request, exception):
    return JsonResponse(
        {"error": "Príliš veľa požiadaviek. Skús neskôr."},
        status=429,
    )    

def compute_pauses_from_words(words, threshold=1.2):
    pauses = []

    if not words or len(words) < 2:
        return {
            "pause_count": 0,
            "long_pauses": [],
        }

    for i in range(1, len(words)):
        prev_word = words[i - 1]
        curr_word = words[i]

        prev_end = prev_word.get("end")
        curr_start = curr_word.get("start")

        if prev_end is None or curr_start is None:
            continue

        gap = curr_start - prev_end

        if gap >= threshold:
            pauses.append({
                "after_word": prev_word.get("word"),
                "before_word": curr_word.get("word"),
                "start": prev_end,
                "end": curr_start,
                "duration": round(gap, 3),
            })

    return {
        "pause_count": len(pauses),
        "long_pauses": pauses,
    }