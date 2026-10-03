# Third-party notices

## MusicD Remote (colour palettes)

The colour palettes in `apps/web/src/theme.css` are adapted from MusicD Remote
(https://github.com/meltface-80/MusicD-Remote).

```
MIT License

Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Roon extension API (protocol reference)

hqpweb's Roon client (`apps/server/src/roon/`) is an independent TypeScript
implementation. Its wire protocol (MOO framing, SOOD discovery, registration and
the transport service) follows Roon Labs' `node-roon-api` and
`node-roon-api-transport` (https://github.com/RoonLabs), which are licensed under
the Apache License 2.0. No code from those projects is included.

## HQPlayer control protocol

hqpweb speaks HQPlayer's control protocol as published by Signalyst in its
MIT-licensed HQPlayer control SDK. No SDK code is included.

## Trademarks

HQPlayer is a trademark of Signalyst. Roon is a trademark of Roon Labs LLC. hqpweb
is not affiliated with, endorsed by, or supported by either.
