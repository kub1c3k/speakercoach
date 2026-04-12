from django.contrib import admin
from .models import Score

@admin.register(Score)
class ScoreAdmin(admin.ModelAdmin):
    list_display = ('user', 'date', 'duration_seconds', 'total_words', 'tempo_wpm')
    list_filter = ('user', 'date')
    search_fields = ('user__username', 'user__email')
    readonly_fields = ('date',)
