from django.contrib import admin
from django.urls import path, include  # ✅ include must be imported
from .views import landing_page
from test.views import testView, get_history, save_session

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', landing_page, name="landingpage"),
    path('accounts/', include('accounts.urls')),  # ✅ include accounts app urls
    path('test/', testView, name="test"),
    path('api/history/', get_history, name='get_history'),
    path('api/save-session/', save_session, name='save_session'),
    
]
