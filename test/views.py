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



from django.db.models import Avg

@login_required
def history_page(request):
    base_scores = Score.objects.filter(user=request.user)
    scores = base_scores.order_by("-date")

    search_id = request.GET.get("id", "").strip()

    if search_id:
        if search_id.isdigit():
            scores = scores.filter(id=int(search_id))
        else:
            scores = scores.none()

    paginator = Paginator(scores, 5) 
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)

    comparison = None
    if base_scores.count() >= 6:
        first_3_ids = list(base_scores.order_by("date")[:3].values_list('id', flat=True))
        last_3_ids = list(base_scores.order_by("-date")[:3].values_list('id', flat=True))

        first_3_stats = Score.objects.filter(id__in=first_3_ids).aggregate(
            avg_eye_contact=Avg('eye_contact_percentage'),
            avg_tempo=Avg('tempo_wpm'),
            avg_filler_ratio=Avg('filler_ratio')
        )
        last_3_stats = Score.objects.filter(id__in=last_3_ids).aggregate(
            avg_eye_contact=Avg('eye_contact_percentage'),
            avg_tempo=Avg('tempo_wpm'),
            avg_filler_ratio=Avg('filler_ratio')
        )
        
        comparison = {
            'first_3': first_3_stats,
            'last_3': last_3_stats
        }

        def safe_get(d, key, default=0.0):
            val = d.get(key)
            return val if val is not None else default

        feedback = []
        
        first_eye = safe_get(first_3_stats, 'avg_eye_contact')
        last_eye = safe_get(last_3_stats, 'avg_eye_contact')
        diff_eye = last_eye - first_eye
        if diff_eye > 5:
            feedback.append({"type": "positive", "text": "Výrazne si zlepšil očný kontakt s publikom (pohľad na stred)."})
        elif diff_eye > 0:
            feedback.append({"type": "positive", "text": "Tvoj očný kontakt s publikom sa mierne zlepšil."})
        elif diff_eye < -5:
            feedback.append({"type": "negative", "text": "Tvoj očný kontakt s publikom klesol. Skús sa viac sústrediť na interakciu s kamerou/publikom."})
        elif diff_eye < 0:
            feedback.append({"type": "negative", "text": "Tvoj očný kontakt s publikom sa mierne zhoršil."})
        else:
            feedback.append({"type": "neutral", "text": "Tvoj očný kontakt s publikom zostal na stabilnej úrovni."})

        first_fill = safe_get(first_3_stats, 'avg_filler_ratio')
        last_fill = safe_get(last_3_stats, 'avg_filler_ratio')
        diff_fill = last_fill - first_fill
        if diff_fill < -0.05:
            feedback.append({"type": "positive", "text": "Skvelá práca, výrazne si znížil používanie parazitných/výplňových slov!"})
        elif diff_fill < 0:
            feedback.append({"type": "positive", "text": "Podarilo sa ti znížiť pomer výplňových slov, si na dobrej ceste."})
        elif diff_fill > 0.05:
            feedback.append({"type": "negative", "text": "V posledných tréningoch častejšie používaš výplňové slová. Skús namiesto nich využívať krátke ticho (pauzy)."})
        elif diff_fill > 0:
            feedback.append({"type": "negative", "text": "Mierne stúplo tvoje používanie výplňových slov."})
        else:
            feedback.append({"type": "neutral", "text": "Pomer tvojich výplňových slov zostáva nezmenený."})

        first_tempo = safe_get(first_3_stats, 'avg_tempo')
        last_tempo = safe_get(last_3_stats, 'avg_tempo')
        diff_tempo = last_tempo - first_tempo
        if diff_tempo > 15:
            feedback.append({"type": "neutral", "text": "Tvoje tempo reči sa oproti prvým tréningom zrýchlilo."})
        elif diff_tempo < -15:
            feedback.append({"type": "neutral", "text": "Tvoje tempo reči sa oproti začiatkom mierne spomalilo."})
        else:
            feedback.append({"type": "positive", "text": "Tvoje tempo reči je stabilné a vyrovnané."})
            
        comparison['feedback'] = feedback

    return render(request, "test/history.html", {
        "page_obj": page_obj,
        "search_id": search_id,
        "comparison": comparison,
    })

@login_required
@require_POST
def save_session(request):
    if len(request.body) > 5 * 1024 * 1024:
        return JsonResponse({"status": "error", "message": "Payload je moc velky"}, status=413)

    try:
        data = json.loads(request.body)

        def safe_int(d, key, default=0):
            val = d.get(key, default)
            return int(val) if val is not None else default

        def safe_float(d, key, default=0.0):
            val = d.get(key, default)
            return float(val) if val is not None else default

        gaze_data = data.get("gaze") or {}
        speech_data = data.get("speech") or {}
        duration_ms = data.get("duration_ms", 0)
        transcript = data.get("transcript", "")
        analysis = data.get("analysis", "")
        long_pauses = data.get("longPauses", [])
        raw_metrics = data.get("rawMetrics", {})

        if not isinstance(gaze_data, dict) or not isinstance(speech_data, dict):
            return JsonResponse(
                {"status": "error", "message": "Zly format gaze alebo speech"},
                status=400
            )

        duration_seconds = max(0, round(safe_int(data, "duration_ms") / 1000))

        score = Score.objects.create(
            user=request.user,
            duration_seconds=duration_seconds,

            eye_contact_percentage=safe_float(gaze_data, "CENTER") * 100,
            left_percentage=safe_float(gaze_data, "LEFT") * 100,
            right_percentage=safe_float(gaze_data, "RIGHT") * 100,
            up_percentage=safe_float(gaze_data, "UP") * 100,
            down_percentage=safe_float(gaze_data, "DOWN") * 100,

            total_words=safe_int(speech_data, "totalWords"),
            tempo_wpm=safe_int(speech_data, "tempoWPM"),
            filler_count=safe_int(speech_data, "fillerCount"),
            pause_count=safe_int(speech_data, "pauseCount"),
            filler_ratio=safe_float(speech_data, "fillerRatio"),

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
    except (TypeError, ValueError):
        return JsonResponse(
            {"status": "error", "message": "nepresla validacia typu"},
            status=400
        )
    except Exception as e:
        return JsonResponse(
            {"status": "error", "message": str(e)},
            status=500
        )

@login_required
@ratelimit(key="user", rate="10/m", method="POST", block=True)
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