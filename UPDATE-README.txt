JMX DIGITAL CARD — THIS UPDATE

WHAT CHANGED
1. jmxdigitalcard.com now opens a JMX Digital Card welcome/marketing page instead of a personal card.
2. Customer cards use permanent short URLs: jmxdigitalcard.com/c/CODE.
3. Existing card design was preserved in card.html.
4. Admin dashboard improvements:
   - total / available / activated / suspended inventory
   - Basic/Premium plan control
   - plan filter
   - total profile opens per active card
   - current-month profile opens
   - Premium public-site ON/OFF switch
   - fixed JMX company QR
   - existing URL generator, activation code, suspend/reactivate, edit and inventory controls preserved
5. Basic/Premium gating remains active.
6. Premium owners see visit statistics from Owner Login. Basic owners do not.
7. First-scan activation and owner login remain connected to Firebase Authentication + Firestore.

FILES TO UPLOAD TO GITHUB
Upload the entire contents of this folder, including the NEW files:
- card.html
- landing.css
- landing.js
and the updated index.html, 404.html, dashboard files, script.js, firestore.rules and the rest of the project.

CRITICAL FIREBASE STEP
Before testing the Premium switch or visit counters:
Firebase Console > Firestore Database > Rules > replace the current rules with firestore.rules from this package > Publish.

GITHUB PAGES
The included 404.html preserves short URLs such as /c/K7P4 while hosting on GitHub Pages.

DO NOT DELETE EXISTING FIRESTORE USERS OR COLLECTIONS.
This update changes web files and rules; it does not intentionally erase customer accounts or existing card/profile records.


PREMIUM ANALYTICS ADDED
- Premium card owners now see limited statistics in their own profile editor: this month, all-time opens, previous month comparison, top action, and a 30-day mini chart.
- Basic owners do not see this analytics section.
- JMX administrator retains broader per-card statistics in the inventory dashboard.
- Public card now tracks profile opens and major button actions into total, monthly, and daily analytics collections.
- IMPORTANT: publish the updated firestore.rules before relying on the new daily analytics.
