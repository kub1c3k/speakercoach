from django.test import TestCase, Client
from django.contrib.auth.models import User
from unittest.mock import patch
from django.urls import reverse
from accounts.models import Score
import json
from django.core.files.uploadedfile import SimpleUploadedFile

class TestViewsTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='test_user', password='password123')

    def test_save_session_unauthenticated(self):
        # We assume save_session is mapped in test/urls.py as 'save_session'
        response = self.client.post(reverse('save_session'), {}, content_type="application/json")
        self.assertEqual(response.status_code, 302) # Redirects to login

    def test_save_session_robust_type_casting(self):
        self.client.login(username='test_user', password='password123')
        payload = {
            "gaze": {"CENTER": None, "LEFT": "50"}, # Testing explicitly None and string representations
            "speech": {"totalWords": None, "tempoWPM": "120"},
            "duration_ms": None,
            "transcript": None,
            "analysis": None
        }
        response = self.client.post(reverse('save_session'), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        
        score = Score.objects.first()
        self.assertIsNotNone(score)
        self.assertEqual(score.user, self.user)
        self.assertEqual(score.duration_seconds, 0)
        self.assertEqual(score.eye_contact_percentage, 0.0)
        self.assertEqual(score.left_percentage, 5000.0) # "50" -> 50.0 * 100
        self.assertEqual(score.total_words, 0)
        self.assertEqual(score.tempo_wpm, 120)

    def test_transcribe_view_unauthenticated(self):
        audio = SimpleUploadedFile("test.wav", b"file_content", content_type="audio/wav")
        response = self.client.post(reverse('transcribe_view'), {"file": audio})
        self.assertEqual(response.status_code, 302)

    @patch('test.views.transcribe_audio')
    def test_transcribe_view_authenticated(self, mock_transcribe):
        self.client.login(username='test_user', password='password123')
        mock_transcribe.return_value = {
            "text": "Ahoj", "words": [], "segments": [], "duration": 1.0, "language": "sk"
        }
        audio = SimpleUploadedFile("test.wav", b"file_content", content_type="audio/wav")
        response = self.client.post(reverse('transcribe_view'), {"file": audio})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['text'], "Ahoj")
