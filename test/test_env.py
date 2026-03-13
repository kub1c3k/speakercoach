from django.test import SimpleTestCase
from django.conf import settings

class EnvTest(SimpleTestCase):
    def test_openai_api_key_exists(self):
        self.assertIsNotNone(settings.OPENAI_API_KEY)
        self.assertNotEqual(settings.OPENAI_API_KEY, "")