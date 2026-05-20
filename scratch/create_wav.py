import wave
import struct
import math

sampleRate = 44100.0
obj = wave.open('test.wav','w')
obj.setnchannels(1)
obj.setsampwidth(2)
obj.setframerate(sampleRate)

for x in range(0, int(sampleRate * 2)): # 2 seconds
    value = int(math.sin(x / ((sampleRate / 440.0) / math.pi)) * 16384.0)
    data = struct.pack('<h', value)
    obj.writeframesraw(data)

obj.close()
print("WAV file created successfully!")
