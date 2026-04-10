from django.test import TestCase
from django.contrib.auth.models import User
from unittest.mock import patch
from django.urls import reverse
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from accounts.tokens import account_activation_token
import json

class AccountsViewsTests(TestCase):
    def test_signup_successful(self):
        # We need to mock email so it doesn't actually try to send Resend emails
        with patch('accounts.views.EmailMessage.send') as mock_send:
            mock_send.return_value = True
            response = self.client.post(reverse('signup'), {
                'username': 'testuser',
                'email': 'testuser@example.com',
                'password1': 'StrongP@ssw0rd123!',
                'password2': 'StrongP@ssw0rd123!'
            })
            
            user = User.objects.get(username='testuser')
            self.assertFalse(user.is_active)
            self.assertEqual(response.status_code, 200)
            self.assertTemplateUsed(response, 'accounts/verification_sent.html')
            mock_send.assert_called_once()

    def test_signup_rolls_back_on_email_failure(self):
        with patch('accounts.views.EmailMessage.send') as mock_send:
            mock_send.side_effect = Exception("SMTP Error")
            response = self.client.post(reverse('signup'), {
                'username': 'failuser',
                'email': 'failuser@example.com',
                'password1': 'StrongP@ssw0rd123!',
                'password2': 'StrongP@ssw0rd123!'
            })
            
            # Should have rolled back, no user created
            self.assertFalse(User.objects.filter(username='failuser').exists())
            self.assertEqual(response.status_code, 200)
            self.assertTemplateUsed(response, 'accounts/signup.html')

    def test_activate_successful(self):
        user = User.objects.create_user(username='actuser', email='act@example.com', password='pw')
        user.is_active = False
        user.save()
        
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = account_activation_token.make_token(user)
        
        url = reverse('activate', kwargs={'uidb64': uid, 'token': token})
        response = self.client.get(url)
        
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertRedirects(response, reverse('dashboard'))

    def test_activate_invalid_token(self):
        url = reverse('activate', kwargs={'uidb64': 'NA', 'token': 'invalid'})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'accounts/activation_invalid.html')
