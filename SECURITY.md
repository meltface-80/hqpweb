# Security

hqpweb has **no login by design**: it's meant for a trusted home network, like
HQPlayer's own control port (4321), which anyone on the network can already use.
Don't expose it to the internet; put an authenticating proxy in front if you need
access from elsewhere. See the README's Security section and `docs/design-v1.md` §7.

Within that model it defends against the browser (DNS rebinding, cross-site writes,
framing) and against misbehaving devices on the network (oversized or malformed
replies). If you find a way around those, or anything else that lets a web page or
another device do what it shouldn't, please report it privately through GitHub's
**"Report a vulnerability"** button on the Security tab rather than in a public issue.
