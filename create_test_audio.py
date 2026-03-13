import wave
import struct
import math

sample_rate = 44100
duration = 2
frequency = 440.0
amplitude = 16000

with wave.open("test_audio.wav", "w") as wav_file:
    wav_file.setnchannels(1)
    wav_file.setsampwidth(2)
    wav_file.setframerate(sample_rate)

    for i in range(sample_rate * duration):
        value = int(amplitude * math.sin(2 * math.pi * frequency * i / sample_rate))
        data = struct.pack("<h", value)
        wav_file.writeframesraw(data)

print("Vytvorený súbor: test_audio.wav")