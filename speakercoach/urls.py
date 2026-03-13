from django.contrib import admin
from django.urls import path, include
from .views import landing_page
from test.views import testView, history_page, save_session

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', landing_page, name="landingpage"),
    path('accounts/', include('accounts.urls')),  
    path("api/", include("test.urls")),
    path('test/', testView, name="test"),
    path('api/history/', history_page, name='history_page'),
    path('api/save-session/', save_session, name='save_session'),
]