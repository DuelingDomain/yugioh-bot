"""Copy for the public guide pages. site/src/build-pages.py turns this data into site/public/*.html.

Rules for every entry:
- `answer` is one short sentence that stands alone as the answer to the page question.
- Claim only features that are live today. The alpha is closed and invitation-only.
- Facts about other products come only from their own public pages and carry a date.
- `body` is trusted HTML written here. `faq` items are plain text (no tags).
"""

CHECKED = '23 November 2026'

PAGES = [
    {
        'slug': '4-player-yugioh',
        'nav': '4-player',
        'title': '4-Player @GAME@ Online, Free for All | Dueling Domain',
        'description': 'Play 4-player @GAME@ online in your browser. Each duelist has their own Life Points, and the last one standing wins. Join the closed alpha waitlist.',
        'eyebrow': 'Free-for-all duels',
        'h1': '4-player @GAME@ online',
        'answer': 'Dueling Domain lets you play 4-player @GAME@ online in your browser: four duelists at one table, each with their own Life Points, and the last duelist standing wins.',
        'video': True,
        'shot': ('/assets/shot-4-player-table.webp', 1920, 1080,
                 'A four-player free-for-all duel in Dueling Domain, on turn 9 in the Main Phase. The four fields sit in a two-by-two grid, so each duelist faces the duelist across from them. Yugi M. at the bottom left has Life Points 6,500, one monster, a Set monster, a Set card and a Field Spell, and faces Kaiba Fan (4,800) at the top left. Mai V. (8,000) and Rex R. (5,200) sit on the right. Each one has their own Graveyard.',
                 'A 4-player table in the closed alpha. The players and boards are sample data.'),
        'body': '''
<h2>How a 4-player table works</h2>
<p>A free-for-all table seats four duelists. Everyone starts with 8,000 Life Points by default, and nobody shares them. You win when every other duelist is out. Three-player tables work the same way with one seat fewer.</p>
<p>The tables open with a dice roll to decide who goes first. These tables use Master Rule 5, so the rules are the ones you know from the current game.</p>
<h2>The engine knows about four players</h2>
<p>Duels run on the open-source EDOPro rules engine. It was built for two players, so we extended it for three and four players and wrote rulings for the cards that need them.</p>
<ul>
<li>A card that says "your opponent" asks you to choose one opponent. The other duelists are not affected.</li>
<li>"Your Life Points are lower than your opponent's" is true only when your Life Points are lower than those of every living opponent.</li>
<li>Cards that win the duel by themselves, such as Exodia, work. The owner wins and every other duelist loses.</li>
</ul>
<p>If you think a ruling is wrong, tell us.</p>
<h2>Start a 4-player game</h2>
<p>Once you are in the alpha, open Duels and choose Create game. Pick the 4-player format, choose the rules and send the invite link to your friends. Each friend needs an account. Everyone plays in a browser tab, with no download.</p>
<p>You can also choose how the game plays. <a href="/domain-format">Domain Format</a> and <a href="/genesys">Genesys</a> points both work at every table size, and so does the classic Standard game. Prefer teams? Read about <a href="/yugioh-tag-duel-online">2v2 Tag duels</a>.</p>
<h2>Who it is for</h2>
<p>Free-for-all is the format for a group of friends who want one big game instead of two small ones. It also suits streams and community nights, because every duelist has the same chance at the win.</p>
<p>The alpha is invitation-only. Join the waitlist and we send an invite by email when your wave opens. The game is free.</p>
''',
        'faq': [
            ('Can I play 4-player @GAME@ online for free?',
             'Yes. Dueling Domain is free to play. The alpha is invitation-only for now, so join the waitlist and we email your invite when your wave opens.'),
            ('Is there a 3-player option?',
             'Yes. Tables seat three or four duelists in free-for-all, two teams of two in Tag, or two duelists in a classic 1v1 duel.'),
            ('Do I need to download anything?',
             'No. You duel in a browser tab. It works best on a desktop or laptop with a modern browser today.'),
            ('Does the game check the rules for me?',
             'Yes. The engine allows only legal plays and resolves chains for you. For three and four players we extended it and wrote rulings for cards that name one opponent.'),
        ],
    },
    {
        'slug': 'yugioh-tag-duel-online',
        'nav': 'Tag duels',
        'title': '@GAME@ Tag Duel Online, 2v2 | Dueling Domain',
        'description': 'Play 2v2 @GAME@ Tag duels online. Two teams of two share one pool of Life Points. Automated rules, no download. Join the closed alpha waitlist.',
        'eyebrow': '2v2 team duels',
        'h1': '@GAME@ Tag duel online',
        'answer': 'Dueling Domain runs 2v2 @GAME@ Tag duels online in your browser: two teams of two, with one shared pool of Life Points for each team.',
        'shot': ('/assets/shot-tag-table.webp', 1920, 1080,
                 'A 2v2 Tag duel in Dueling Domain, on turn 9 in the Main Phase. Yugi M. and Mai V. (team 1, 12,300 shared Life Points) face Kaiba Fan and Rex R. (team 2, 9,500). Each duelist has their own field, the facing duelists share the middle Extra Monster Zones, and Yugi M. sees the hand of Mai V. in a panel that says only the team sees it.',
                 'A 2v2 Tag table in the closed alpha. The players and boards are sample data.'),
        'body': '''
<h2>The Tag rules we use</h2>
<p>A Tag table seats four duelists in two teams. The rules are written down, and the engine applies them for you.</p>
<ul>
<li><strong>One Life Point total per team.</strong> It equals the starting Life Points of both partners added together. With the default 8,000, each team starts at 16,000.</li>
<li><strong>Shared field and Graveyard.</strong> "You control", "your field" and "your Graveyard" include your partner's cards. "Your hand" and "your Deck" mean only your own.</li>
<li><strong>Facing duelists.</strong> Each duelist faces one opponent. The two who face each other share the Extra Monster Zones and the columns between them, in the same way as a 1v1 duel.</li>
<li><strong>Direct attacks.</strong> You can attack directly only when both opposing duelists control no monsters. A monster of either opponent protects the shared Life Points.</li>
</ul>
<p>Tag tables use Master Rule 5, like the other multiplayer tables.</p>
<h2>Play it your way</h2>
<p>Tag works with the classic Standard game, with <a href="/domain-format">Domain Format</a>, and with <a href="/genesys">Genesys</a> points. Every duelist builds their own deck, so partners can bring different strategies.</p>
<p>To start, open Duels and choose Create game. Pick the Tag format, choose the rules and send the invite link. Friends join the seats, and each team has two. You do not install anything.</p>
<h2>Why a browser Tag table helps</h2>
<p>Tag duels are hard to set up in person. You need four players, a large table and someone who knows the shared-card rulings. In Dueling Domain the table is already set, the engine keeps count of the team Life Points, and each player sees their own hand.</p>
<p>If you want one big game with no teams, try <a href="/4-player-yugioh">4-player free-for-all</a>. Tell us when you think a Tag ruling is wrong.</p>
<p>The alpha is free and invitation-only. Join the waitlist to get an invite when your wave opens.</p>
''',
        'faq': [
            ('How many Life Points does a Tag team have?',
             'Each team has one shared total. It is the starting Life Points of both partners added together, so a team starts at 16,000 with the default 8,000.'),
            ('Can I use my partner\'s cards?',
             'Your partner\'s field and Graveyard count as yours for "you control" and "your Graveyard". Your hand and your Deck stay private to you.'),
            ('When can a team attack directly?',
             'Only when both opposing duelists control no monsters. A monster of either opponent guards the shared Life Points.'),
            ('Do I need a download or an account?',
             'You need an account and an invite for the closed alpha. The game runs in your browser, with no download.'),
        ],
    },
    {
        'slug': 'yugioh-cube-draft',
        'nav': 'Cube draft',
        'title': '@GAME@ Cube Draft Online with Friends | Dueling Domain',
        'description': 'Run a @GAME@ cube or booster draft online. Pick from passed packs on a clock, build a deck from your pool, then duel in the same tab. Join the waitlist.',
        'eyebrow': 'Drafts',
        'h1': '@GAME@ cube draft online',
        'answer': 'You can run a @GAME@ cube or booster draft in Dueling Domain: friends pick cards from packs on a timer, build a deck from their picks and duel in the same browser tab.',
        'shot': ('/assets/shot-draft-pick.webp', 1920, 1080,
                 'The draft pick screen in Dueling Domain. A pack of five cards lies on the table (Stardust Dragon, Change of Heart, Heavy Storm, Infinite Impermanence and Celtic Guardian). The card list, the picks so far and a pick clock are on the right.',
                 'The draft pick screen in the closed alpha. The players and the pack are sample data.'),
        'body': '''
<h2>How a draft runs</h2>
<p>The host creates a draft and sends an invite link. Two or more players can join. When the host starts, a short countdown runs and the first packs open. Each player picks a card, passes the pack on and picks again from the next pack. A pick clock keeps the draft moving.</p>
<p>When the last pick is made, your picks are your pool. You build a deck from that pool and duel with it in the same tab. There is nothing to export or print.</p>
<h2>Options the host can set</h2>
<ul>
<li>How many cards are in each pack.</li>
<li>One pick or two picks per turn.</li>
<li>How many seconds each pick takes.</li>
<li>A limit of three copies of a card.</li>
<li>An optional Extra Deck draft, after the Main Deck rounds.</li>
</ul>
<p>If the host stops a draft early, the draft is cancelled for everyone. Start a new one when your group is ready.</p>
<h2>Build your own cube</h2>
<p>A cube is a card pool that you control. You can make a cube from archetypes, or import one from a list of card names, a plain text file or a .ydk file. Your cubes are private to your account.</p>
<p>When you build a deck from your picks, you can also import a deck from a .ydk file, a ydke link or a list of names. The deck builder also shows <a href="/genesys">Genesys</a> points when you play that format.</p>
<h2>Why draft here</h2>
<p>A draft in person needs packs, sleeves and a lot of space. Online, the card pool is ready, the pick clock is fair to everyone and the result goes straight into a deck. After the draft you can duel in the same place. Choose a classic 1v1, a <a href="/yugioh-tag-duel-online">Tag duel</a> or a <a href="/4-player-yugioh">4-player game</a>.</p>
<p>The alpha is free and invitation-only. Join the waitlist and we send your invite when your wave opens.</p>
''',
        'faq': [
            ('How many players can join a draft?',
             'Two or more players. The host sends an invite link and starts the draft with a short countdown.'),
            ('Can I use my own card list as a cube?',
             'Yes. You can build a cube in the editor, or import it from card names, a text file or a .ydk file. Cubes are private to your account.'),
            ('What happens after the draft?',
             'Your picks become your pool. You build a deck from it and duel in the same browser tab.'),
            ('Is the draft free?',
             'Yes. Dueling Domain is free to play. The alpha is invitation-only for now, so join the waitlist to get an invite.'),
        ],
    },
    {
        'slug': 'domain-format',
        'nav': 'Domain Format',
        'title': 'Domain Format Online, Deck Master Rules | Dueling Domain',
        'description': 'Play Domain Format online. Each duelist keeps a Deck Master in its own zone. Dueling Domain runs the rules for you at 1v1, Tag and free-for-all tables.',
        'eyebrow': 'Community format',
        'h1': 'Domain Format online',
        'answer': 'Domain Format is a community @GAME@ format where each duelist keeps a Deck Master in a zone of its own, and Dueling Domain runs those rules for you in the browser.',
        'shot': ('/assets/shot-domain-format.webp', 1920, 1080,
                 'A Domain Format duel in Dueling Domain, on turn 7 in the Main Phase. The Deck Master Dark Magician waits in its zone, ready to use, beside a field with two monsters, one Set card, a Field Spell and a Graveyard. The other duelist has a Deck Master too. Life Points are 6,000 and 4,400.',
                 'A Domain Format duel in the closed alpha. The players and boards are sample data.'),
        'body': '''
<h2>What changes in Domain Format</h2>
<p>Domain Format adds one idea to the normal game: the Deck Master. It is a monster that starts outside your decks, in its own zone. You can summon it, and you can return it to its zone later.</p>
<p>Domain Format is a community format. Dueling Domain is not affiliated with its organizers. We follow the written rules and tell you when we are not sure.</p>
<h2>Deck rules we enforce</h2>
<ul>
<li>The Main Deck has exactly 60 cards and the Extra Deck has at most 15.</li>
<li>Main Deck and Extra Deck are singleton. You can have one copy of each card, including alternate art.</li>
<li>There is no Side Deck.</li>
<li>The Deck Master is separate from those counts. It cannot also be in your decks.</li>
<li>There is no ban list unless the host chooses one.</li>
<li>The cards in your deck must belong to your Deck Master's Domain. That includes its archetypes, Attributes and Monster Types, and the ones its effect text names. Spell and Trap cards have no Domain restriction.</li>
</ul>
<h2>The cost of using a Deck Master</h2>
<p>Using a Deck Master costs Life Points. The first time it leaves its zone is free. After that, the cost is 500 Life Points for each time it has already returned to the zone. The engine keeps the count, so you do not have to track it by hand.</p>
<h2>Every table size</h2>
<p>Domain works in a 1v1 duel, in <a href="/yugioh-tag-duel-online">2v2 Tag</a> and in <a href="/4-player-yugioh">3- and 4-player free-for-all</a>. You can also combine it with <a href="/genesys">Genesys</a> points. The table then shows as Genesys Domain.</p>
<p>The deck builder checks your deck against these rules before you duel. You can import a deck from a .ydk file, a ydke link or a list of card names.</p>
<p>The alpha is free and invitation-only. Join the waitlist to get an invite when your wave opens.</p>
''',
        'faq': [
            ('What is a Deck Master?',
             'A Deck Master is a monster that you keep in its own zone, apart from your Main Deck. It can leave that zone and return to it. The first leave is free, and later leaves cost Life Points.'),
            ('How big is a Domain deck?',
             'The Main Deck has exactly 60 cards and the Extra Deck has at most 15. Both are singleton, and there is no Side Deck.'),
            ('Can I play Domain Format with three or four players?',
             'Yes. Domain works at every table size: 1v1, Tag, and three- or four-player free-for-all.'),
            ('Is Dueling Domain the official home of the format?',
             'No. Domain Format is a community format and we are not affiliated with its organizers. We run its rules in the simulator.'),
        ],
    },
    {
        'slug': 'genesys',
        'nav': 'Genesys',
        'title': 'Genesys Format Online, Points Builder | Dueling Domain',
        'description': 'Play Genesys online. Each card has points and your deck stays under a cap. The deck builder counts them for you. Join the closed alpha waitlist.',
        'eyebrow': 'Points format',
        'h1': 'Genesys format online',
        'answer': 'Genesys is a @GAME@ format where each card has a point value and your deck must stay under a point cap, and the Dueling Domain deck builder counts the points for you.',
        'shot': ('/assets/shot-genesys-deck.webp', 1120, 900,
                 'The Dueling Domain deck builder in Genesys mode. A points meter shows 98 of 100 points used. A 40-card Main Deck of monsters, spells and traps, one Extra Deck card and an empty Side Deck are below it. Each card with a cost shows its point value.',
                 'The deck builder in Genesys mode, with a sample deck.'),
        'body': '''
<h2>How Genesys works</h2>
<p>In Genesys, points replace the ban list. Most cards are worth zero points. A smaller set of strong cards carry points, and your deck can hold only so many points in total. You choose which strong cards fit under the cap.</p>
<p>In Dueling Domain, choosing Genesys turns the ban list off. The point cap is yours to set. The default is 100, and you can pick any whole number from 0 to 1000.</p>
<h2>The points list</h2>
<p>The deck builder uses the current points list for the TCG. A background job checks the list every week and updates the points when it changes. </p>
<p>The deck builder shows your running total while you build. If a deck goes over the cap, the deck builder flags it before you start a duel.</p>
<h2>Standard or Domain</h2>
<p>Genesys is a layer on top of the duel mode:</p>
<ul>
<li>Genesys with the classic Standard game shows as <strong>Genesys</strong>.</li>
<li>Genesys with <a href="/domain-format">Domain Format</a> shows as <strong>Genesys Domain</strong>.</li>
</ul>
<p>Both work at every table size: 1v1, <a href="/yugioh-tag-duel-online">2v2 Tag</a> and <a href="/4-player-yugioh">3- and 4-player free-for-all</a>.</p>
<h2>Save decks and play</h2>
<p>You can save a Genesys deck with its point cap. The same deck can be imported from a .ydk file, a ydke link or a list of names. Then you create a game, choose the Genesys option and invite your friends.</p>
<p>The alpha is free and invitation-only. Join the waitlist and we send an invite by email when your wave opens.</p>
''',
        'faq': [
            ('What is the Genesys point cap?',
             'You choose the cap. The default is 100, and it can be any whole number from 0 to 1000.'),
            ('Does Genesys use a ban list?',
             'No. In Dueling Domain, Genesys points replace the ban list, and the ban list is turned off for those games.'),
            ('Where does the points list come from?',
             'The TCG points list is synced every week from a public card database, and the deck builder uses the latest accepted list.'),
            ('Can I play Genesys with Domain Format or in multiplayer?',
             'Yes. Genesys works with Standard or Domain at every table size. With Domain it shows as Genesys Domain.'),
        ],
    },
    {
        'slug': 'compare',
        'nav': 'Compare',
        'title': '@GAME@ Simulators Compared | Dueling Domain',
        'description': 'How Dueling Domain compares with EDOPro, Dueling Nexus, YGO Omega and Master Duel. Facts come from each project\'s own page and carry a date.',
        'eyebrow': 'Comparison',
        'h1': '@GAME@ simulators compared',
        'answer': 'Dueling Domain is a free browser simulator in closed alpha that focuses on 3- and 4-player duels, Tag, drafts, Domain Format and Genesys; this page lists other ways to play, using only facts from their own pages.',
        'video': True,
        'body': '''
<h2>How we wrote this page</h2>
<p>We checked each product on @DATE@. We list only what its own page states. If a page does not say something, we do not guess. This page does not say that another product lacks a feature unless that product says so. Things change, so check each site for the latest.</p>
<h2>Dueling Domain</h2>
<ul>
<li>Runs in a browser tab, with no download.</li>
<li>Free to play. The alpha is invitation-only, with a waitlist.</li>
<li>Table formats: 1v1, 2v2 Tag, and 3- and 4-player free-for-all.</li>
<li>Game modes: classic Standard, <a href="/domain-format">Domain Format</a> and <a href="/genesys">Genesys</a> points.</li>
<li>Cube and booster <a href="/yugioh-cube-draft">drafts</a> in the same place as the duels.</li>
<li>Duels run on the open-source EDOPro rules engine, which we extended for three and four players.</li>
</ul>
<h2>EDOPro</h2>
<ul>
<li>Describes itself as "the open-source automatic duel simulator".</li>
<li>Says it is available on Windows, Mac and Linux.</li>
<li>Describes itself as an evolution of the YGOPro system.</li>
</ul>
<p>Source: the Project Ignis website, checked @DATE@.</p>
<h2>Dueling Nexus</h2>
<ul>
<li>Says it is free.</li>
<li>Says it runs entirely in the browser, so there is no client to download.</li>
<li>Says it has unranked and ranked game modes and a deck editor.</li>
<li>Says chains, timing and priority resolve themselves.</li>
</ul>
<p>Source: <a href="https://duelingnexus.com/" rel="noopener">duelingnexus.com</a>, checked @DATE@.</p>
<h2>YGO Omega</h2>
<ul>
<li>Describes itself as a free simulator.</li>
<li>Says it runs through a launcher on Windows, macOS, Linux, Android and iOS.</li>
<li>Says every card is unlocked, ranked play is open and tournaments cost nothing.</li>
<li>Has automatic rules: it says the engine tracks life points, chains, timing windows and priority. It also has a manual mode.</li>
</ul>
<p>Source: <a href="https://omega.duelistsunite.org/" rel="noopener">omega.duelistsunite.org</a>, the official YGO Omega site, checked @DATE@.</p>
<h2>Master Duel</h2>
<ul>
<li>The official video game. Its product page says it is free to play with in-game purchases.</li>
<li>Lists PlayStation 5 and 4, Xbox Series X|S and Xbox One, Steam, Nintendo Switch, iOS and Android.</li>
</ul>
<p>Source: the official Master Duel product page, checked @DATE@.</p>
<h2>Which one should you pick?</h2>
<p>If you want an official game on a console or phone, Master Duel is built for that. If you want a program for Windows, Mac or Linux, EDOPro and YGO Omega are two. If you want a browser game, both Dueling Nexus and Dueling Domain run in the browser. Dueling Domain is the one to try when you want free-for-all and Tag tables, drafts, Domain Format or Genesys in the same place, and you can wait for an invite.</p>
<p>Dueling Domain is an unofficial fan project. It is not affiliated with any product on this page.</p>
''',
        'faq': [
            ('Is Dueling Domain free?',
             'Yes. It is free to play. The alpha is invitation-only for now, so you join the waitlist and get an email invite when your wave opens.'),
            ('Do I need to download Dueling Domain?',
             'No. It runs in your browser. It works best on a desktop or laptop today.'),
            ('Does Dueling Domain use the same rules engine as EDOPro?',
             'Duels run on the open-source EDOPro rules engine. We extended it for three- and four-player tables and wrote rulings for them.'),
            ('Where do these facts come from?',
             'From each product\'s own public page, checked on @DATE@. We list only what the page states.'),
        ],
    },
    {
        'slug': 'about',
        'nav': 'About',
        'title': 'About Dueling Domain, a @GAME@ Simulator',
        'description': 'Dueling Domain is a free, fan-made @GAME@ simulator for the browser. Learn what you can play, how access works and how to reach us.',
        'eyebrow': 'About',
        'h1': 'About Dueling Domain',
        'answer': 'Dueling Domain is a free, fan-made @GAME@ simulator that runs in your browser, built by the Dueling Domain team for friends who want automated duels and drafts together.',
        'video': True,
        'body': '''
<h2>What you can play today</h2>
<p>Dueling Domain puts the whole evening in one tab. You can run a <a href="/yugioh-cube-draft">cube draft</a>, build a deck from your picks and duel with friends. Duels cover a classic 1v1, <a href="/yugioh-tag-duel-online">2v2 Tag</a> and <a href="/4-player-yugioh">3- and 4-player free-for-all</a>. You can add <a href="/domain-format">Domain Format</a> or <a href="/genesys">Genesys</a> points at any table size.</p>
<p>Duels run on the open-source EDOPro rules engine, so only legal plays are allowed and chains resolve for you.</p>
<h2>Who it is for</h2>
<p>Dueling Domain is for groups of friends, local communities and streamers who want to play together without a table, a stack of packs or a rules expert nearby. You can also play a single duel against one friend, and the same tab handles deck building. It works best on a desktop or laptop with a modern browser today.</p>
<h2>Access: a closed alpha</h2>
<p>The alpha is free and invitation-only. Joining the waitlist does not guarantee access. We send invitations by email in waves. The app needs a sign-in, and its private pages are not part of this public site.</p>
<h2>Unofficial fan project</h2>
<p>Dueling Domain is not an official @GAME@ game. It is not affiliated with or endorsed by the owners of the game. If you are a rights holder and you have a concern, email <a href="mailto:support@duelingdomain.com">support@duelingdomain.com</a>.</p>
<h2>Open source</h2>
<p>We extended an open-source engine. The footer of every page links to our engine source code, under the AGPL licence.</p>
<h2>Your data</h2>
<p>Read the <a href="/privacy">privacy page</a> for what we collect, who processes it and how to ask for deletion. The <a href="/terms">terms</a> cover alpha access, accounts and fair play.</p>
<h2>How to join</h2>
<p>Use the waitlist button on this page. It takes you to the sign-up form on the home page. When your wave opens, we email an invite with the steps to create your account.</p>
<h2>Follow the changes</h2>
<p>We post public patch notes for each version on the <a href="/updates">updates page</a>. If you want to see how we differ from other ways to play, read the <a href="/compare">comparison</a>.</p>
''',
        'faq': [
            ('Who makes Dueling Domain?',
             'The Dueling Domain team makes it. You can reach us at support@duelingdomain.com.'),
            ('Is Dueling Domain an official @GAME@ game?',
             'No. It is an unofficial fan project, not affiliated with or endorsed by the owners of the game.'),
            ('How do I get access?',
             'Join the waitlist on the home page. The alpha is invitation-only, and we send invitations by email in waves.'),
            ('Is it free?',
             'Yes. Dueling Domain is free to play.'),
        ],
    },
]
