from django.shortcuts import render
from django.shortcuts import render
from django.http import JsonResponse
import json

def testView(request):
    return render(request, "test/test.html")



def home(request):
    return render(request, 'index.html')

def get_history(request):
    # Toto by v reálnej aplikácii čítalo z databázy
    history = request.session.get('speech_history', [])
    return JsonResponse({'history': history})

def save_session(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            # Uloženie do session alebo databázy
            history = request.session.get('speech_history', [])
            history.append({
                'score': data.get('score'),
                'duration': data.get('duration'),
                'timestamp': data.get('timestamp')
            })
            request.session['speech_history'] = history[-10:]  # Keep last 10
            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    
    return JsonResponse({'status': 'error', 'message': 'Invalid method'})