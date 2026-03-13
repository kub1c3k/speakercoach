from django.db import models
from django.contrib.auth.models import User


class Score(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="scores")
    date = models.DateTimeField(auto_now_add=True)

    duration_seconds = models.PositiveIntegerField(default=0)

    eye_contact_percentage = models.FloatField(default=0)
    left_percentage = models.FloatField(default=0)
    right_percentage = models.FloatField(default=0)
    up_percentage = models.FloatField(default=0)
    down_percentage = models.FloatField(default=0)

    total_words = models.PositiveIntegerField(default=0)
    tempo_wpm = models.PositiveIntegerField(default=0)
    filler_count = models.PositiveIntegerField(default=0)
    pause_count = models.PositiveIntegerField(default=0)
    filler_ratio = models.FloatField(default=0)

    transcript = models.TextField(blank=True, default="")
    analysis = models.TextField(blank=True, default="")

    long_pauses = models.JSONField(default=list, blank=True)
    raw_metrics = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.user.username} - {self.date.strftime('%Y-%m-%d %H:%M')}"