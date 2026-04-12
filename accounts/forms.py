from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm
from django.utils.translation import gettext_lazy as _


class SignUpForm(UserCreationForm):
    email = forms.EmailField(
        max_length=254,
        label="Email",
        help_text="Povinný. Zadajte platnú emailovú adresu."
    )

    class Meta:
        model = User
        fields = ('username', 'email')
        labels = {
            'username': 'Používateľské meno',
            'password1': 'Heslo',
            'password2': 'Potvrdenie hesla',
        }
        help_texts = {
            'username': 'Zadajte svoje používateľské meno',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self.fields['password1'].help_text = (
            "Heslo nesmie byť príliš podobné vašim osobným údajom.<br>"
            "Heslo musí obsahovať aspoň 8 znakov.<br>"
            "Heslo nesmie byť bežne používané.<br>"
            "Heslo nesmie pozostávať iba z číslic."
        )

        self.fields['password2'].help_text = (
            "Zadajte rovnaké heslo ešte raz pre potvrdenie."
        )

        for field in self.fields.values():
            field.widget.attrs.update({
                "class": "w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            })

    def clean_email(self):
        email = self.cleaned_data.get('email')
        if email and User.objects.filter(email=email).exists():
            raise forms.ValidationError("Účet s týmto emailom už existuje.")
        return email
