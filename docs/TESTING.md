# Testing the site (Isaac's full test, 2026-11-12)

Everything below is live on the test address, https://studio-site.bobdylan2000.workers.dev/, which stays a test site
until your own web address is attached (D-169). Studio (your side) is at `/studio`; sign in with your email code.

Use **your own email** for every test buyer, collector and follower. On this site emails are real, so a made-up or
someone else's address would get them. Write down anything odd (page, what you tapped, what you expected); the final
pass in Claude Code starts from that list.

## 1. The public site (stage 2)
- Home, Works, a piece page, Commissions, Process, About, Contact. On a phone, and with the phone in dark mode.
- On a piece: Text, Email and Call buttons (the number shows only after a tap).
- Sold works hide the price and offer "commission one like this".

## 2. Ask and the inquiry list (stage 3)
- Tap **Ask** and ask about a colour, a size or a price. Cards should show only real pieces.
- Ask something it can't know (installation, a show date): it should offer Text, Email or Call, not guess.
- **Add to inquiry** on two pieces, open `/inquiry`, download the sheet as a picture.
- Studio → **Leads**: questions you sent from the site land here.

## 3. Buying (stage 4; card payments are off until the Square test, D-162)
- Studio → **Site → Checkout**: turn on **Venmo / Zelle** with your Venmo name and Zelle address to test it. Card
  (Square) stays off.
- On a piece: **Buy** → Venmo/Zelle → your own details. The thanks page shows the amount and order code; the piece
  shows as on hold.
- Studio → **Orders**: the order is waiting. **Mark paid** sells the piece. Try **Cancel** on a second test order:
  the piece is for sale again.
- Turn Venmo / Zelle off again afterwards if you don't want it on yet.

## 4. On your wall (stage 5)
- On a piece with a size: **See it on your wall**. On iPhone, the live camera view; on any phone, a photo of your
  wall sized from two taps on something you measured.

## 5. Collectors (stage 6)
- Studio → **Collectors → Add a collector**: a test collector with your own email.
- Open them: **Make their link**, then **Email their invite**. Open the link from the email: their page says "Hello" with their
  first name.
- On a work (Studio → Works → a piece → **Collectors** card): **Sold to** that collector → it shows in their
  collection. Tap it on their page for the certificate, then **Print or save as PDF**.
- On an available public work: **Start first look**. It disappears from the public Works page but shows on the
  collector's page for 7 days. **End first look now** puts it back.
- Back on the collector, under **Commissions**: start one, move it to the next stage, add a note. Their page shows the stage
  (never the price).
- Care notes: Studio → Collectors → **Care notes**. A draft is filled in; edit and **Save care notes** (collectors
  see nothing until you do).
- Follow: the footer's **Follow the studio** → your email → the code from the email → your follower page. **Stop
  following** works.
- Show QR codes: Studio → Collectors → **Show QR codes**. Scan one with your phone: it opens the follow page for that show.
- Studio → Collectors → **First look → Email followers about first look**: sends it to linked collectors and
  followers.
  Only you, if you are the only test follower.

## On hold
- The Square card test (D-162) and the second studio (stage 7, D-170).
