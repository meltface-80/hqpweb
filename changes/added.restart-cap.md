- **Volume after HQPlayer restarts.** HQPlayer comes back from a restart at its saved
  volume, which can be louder than you left it. In Settings → Listening you can set a cap
  per HQPlayer: when hqpweb sees HQPlayer stop answering and come back at a different,
  louder volume, it turns it down to the cap, about a second after HQPlayer answers again
  (measured on a real restart), and notes it in History. It never raises the volume, and a
  network blip that leaves the volume alone is left alone. It works only while hqpweb is
  running; with a cap set, hqpweb checks HQPlayer once a second even with no page open.
  Off by default.
