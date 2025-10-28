from django.db import models

from django.contrib.auth.models import User
from django.db import models

class Score(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='scores')
    date = models.DateTimeField(auto_now_add=True)
    eye_contact_percentage = models.FloatField()

    def __str__(self):
        return f"{self.user.username} - {self.eye_contact_percentage}% on {self.date.strftime('%Y-%m-%d')}"

