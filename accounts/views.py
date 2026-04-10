import logging
from django.shortcuts import render, redirect
from django.contrib.auth import login, logout
from django.contrib.sites.shortcuts import get_current_site
from django.template.loader import render_to_string
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.models import User
from django.core.mail import EmailMessage
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.db import transaction

from .forms import SignUpForm
from .tokens import account_activation_token
from .models import Score

logger = logging.getLogger(__name__)


def signup(request):
    if request.method == 'POST':
        form = SignUpForm(request.POST)

        if form.is_valid():
            try:
                with transaction.atomic():
                    user = form.save(commit=False)
                    user.is_active = False
                    user.save()

                    current_site = get_current_site(request)
                    mail_subject = 'Overenie účtu'
                    message = render_to_string('accounts/acc_active_email.html', {
                        'user': user,
                        'domain': current_site.domain,
                        'uid': urlsafe_base64_encode(force_bytes(user.pk)),
                        'token': account_activation_token.make_token(user),
                    })

                    email = EmailMessage(
                        subject=mail_subject,
                        body=message,
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        to=[user.email],
                    )
                    email.content_subtype = "html"
                    email.send(fail_silently=False)

                    return render(request, 'accounts/verification_sent.html')

            except Exception as e:
                logger.exception("Signup failed after valid form submission")

                return render(request, 'accounts/signup.html', {
                    'form': form,
                    'error_message': 'Vyskytla sa chyba pri odosielaní potvrdzovacieho e-mailu. Skúste to prosím neskôr.'
                })

        else:
            logger.warning("Signup form invalid: %s", form.errors)

    else:
        form = SignUpForm()

    return render(request, 'accounts/signup.html', {'form': form})

def activate(request, uidb64, token):
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None
    if user and account_activation_token.check_token(user, token):
        user.is_active = True
        user.save()
        login(request, user)
        return redirect('dashboard')
    else:
        return render(request, 'accounts/activation_invalid.html')

@login_required
def dashboard(request):
    scores = request.user.scores.all().order_by('-date')
    return render(request, 'accounts/dashboard.html', {'scores': scores})

def logout_view(request):
    logout(request)
    return redirect('login')