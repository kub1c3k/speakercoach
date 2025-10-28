from django.shortcuts import render, redirect
from django.contrib.auth import login
from django.contrib.sites.shortcuts import get_current_site
from django.template.loader import render_to_string
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.models import User
from django.core.mail import EmailMessage
from django.contrib.auth.decorators import login_required
from .forms import SignUpForm
from .tokens import account_activation_token
from .models import Score

# Registration view
def signup(request):
    if request.method == 'POST':
        form = SignUpForm(request.POST)
        if form.is_valid():
            user = form.save(commit=False)
            user.is_active = False  # deactivate until email verified
            user.save()
            # Send verification email
            current_site = get_current_site(request)
            mail_subject = 'Overenie účtu'
            message = render_to_string('accounts/acc_active_email.html', {
                'user': user,
                'domain': current_site.domain,
                'uid': urlsafe_base64_encode(force_bytes(user.pk)),
                'token': account_activation_token.make_token(user),
            })
            email = EmailMessage(mail_subject, message, to=[user.email])
            email.send()
            return render(request, 'accounts/verification_sent.html')
    else:
        form = SignUpForm()
    return render(request, 'accounts/signup.html', {'form': form})

# Activate account
def activate(request, uidb64, token):
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except:
        user = None
    if user and account_activation_token.check_token(user, token):
        user.is_active = True
        user.save()
        login(request, user)
        return redirect('dashboard')
    else:
        return render(request, 'accounts/activation_invalid.html')

# Dashboard view
@login_required
def dashboard(request):
    scores = request.user.scores.all().order_by('-date')
    return render(request, 'accounts/dashboard.html', {'scores': scores})
