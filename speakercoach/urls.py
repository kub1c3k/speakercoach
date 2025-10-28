from django.contrib import admin
from django.urls import path, include  # ✅ include must be imported
from .views import landing_page
from test.views import testView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', landing_page, name="landingpage"),
    path('accounts/', include('accounts.urls')),  # ✅ include accounts app urls
    path('test/', testView, name="test"),
]
