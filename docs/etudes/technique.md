# Étude technique — extension navigateur + serveur local (2026-09-16)

Source : worker `research-4f8022` (sonnet46, pyr-search + firecrawl). Rapport brut.

## 1. Panneau latéral Chrome MV3 (`chrome.sidePanel`)

API stable depuis Chrome 114. Manifest : permission `"sidePanel"` + clé `"side_panel": {"default_path": "panel/panel.html"}`.
(source: https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

Peut : activation par onglet (`setOptions({tabId, enabled, path})`), survit à la navigation dans le même onglet tant que l'utilisateur le laisse ouvert. **Un seul panneau par fenêtre**, pas un par onglet.

Ne peut pas : `open()` exige un geste utilisateur (Chrome 116+), aucun déclenchement programmatique. Le panneau **ne maintient pas le service worker en vie** → traiter chaque `sendMessage` comme un démarrage à froid possible. Pas de persistance inter-fenêtres.

## 2. Parité Firefox

Firefox 121+ supporte MV3, mais son équivalent est `sidebarAction` (clé `sidebar_action`), antérieur à l'API Chrome.

| Aspect | Chrome 120+ | Firefox 121+ |
|---|---|---|
| API | `chrome.sidePanel` | `browser.sidebarAction` |
| Portée | par onglet | par fenêtre |
| Contrôle par onglet | `setOptions({tabId})` | aucun |
| Ouverture programmatique | geste requis | `sidebarAction.open()` |

Divergences forcées : deux sections de manifest, deux appels d'API dans le background script, et pour Firefox la logique « activé pour cet onglet » doit migrer **dans le document du panneau** (afficher un état vide plutôt que désactiver).

Codebase unique : réaliste avec un manifest scindé. Panneau HTML/JS écrit une fois, `webextension-polyfill` pour normaliser `chrome.*` → `browser.*`, branche uniquement dans le module d'enregistrement. Safari n'a aucune surface dockée → repli `windows.create()`.

## 3. Appeler `http://localhost:PORT` depuis l'extension — LNA

**Point critique 2026.** Chrome déploie **Local Network Access (LNA)**, qui remplace les avertissements Private Network Access : une requête d'une origine « publique » vers `127.0.0.0/8` déclenche une **demande de permission explicite**. Chrome 138 = opt-in par flag, Chrome 139+ = activé par défaut.
(source: https://developer.chrome.com/blog/local-network-access)

Zone grise : les pages `chrome-extension://` ne sont pas clairement classées « publique » ou « locale » dans la spec — **[UNVERIFIED]**. Confirmé en revanche : un service worker qui appelle le réseau local exige que la permission LNA ait été accordée **auparavant depuis un document** ; pas de prompt déclenchable depuis le SW (bug ouvert crbug.com/404887282).

Requis dans tous les cas :
- `host_permissions`: `["http://localhost:PORT/*"]`
- CSP de l'extension (`content_security_policy.extension_pages`) : `connect-src http://localhost:PORT`
- panneau et service worker peuvent alors `fetch()` le serveur local directement.

**Échappatoire** : les WebSockets vers localhost ne sont pas encore soumis à LNA (bug ouvert crbug.com/421156866).

## 4. Réalité de la revue de store

Permissions qui déclenchent une revue manuelle : `<all_urls>` ou patterns d'hôtes larges, `tabs`, `webNavigation`, `cookies`, `history`. Lecture de page par content script + appel serveur = file de revue manuelle quasi certaine.

Politique « remote code » (règle dure MV3) : toute la logique doit être dans le paquet. Interdits : `eval()` sur chaîne distante, `<script src="externe">`, interpréteur de commandes distantes. **Appeler un serveur local pour l'inférence LLM est explicitement autorisé** (Technical Requirements §3.iv, « performing server-side operations with data »).
(source: https://developer.chrome.com/docs/webstore/program-policies/policies)

Divulgations obligatoires : politique de confidentialité, divulgation pré-installation des données collectées, déclaration Limited Use sur le site du développeur. La collecte d'activité de navigation est **interdite** sauf si c'est une fonctionnalité visible et annoncée.

Piège qualité : les extensions à panneau latéral qui « détournent la navigation ou l'expérience de recherche » sont une violation explicite (Quality Guidelines §2.i).

## 5. Patterns de sécurité désormais obligatoires

- **Isolation des content scripts** : mondes isolés — scope JS séparé, DOM partagé. Une page hostile ne peut pas appeler les fonctions du content script, mais elle peut écrire dans les nœuds DOM qu'il lit. Assainir tout contenu issu du DOM avant de l'envoyer au service worker ou au serveur local. Jamais d'`innerHTML` depuis le contenu de page.
- **Messages des content scripts = non fiables** : valider `sender.origin`, valider la forme du message, jamais d'`eval`.
- **Éviter `<all_urls>`** : `activeTab` (accordé pendant un geste utilisateur) + host permissions optionnelles demandées à l'exécution. Réduit la friction de revue et le rayon de souffle d'un content script compromis.
- **Empêcher une page hostile d'atteindre le serveur local** : la page ne peut pas appeler `chrome-extension://` directement, mais si le serveur local répond `Access-Control-Allow-Origin: *`, une page peut solliciter le service worker par messages forgés et l'atteindre indirectement. Parades : (1) le serveur local valide l'en-tête `Origin` — n'accepter que `chrome-extension://<ID>` ; (2) secret partagé stocké dans `chrome.storage.session` (mémoire seule) que le serveur vérifie.
- **Stockage des secrets** : `chrome.storage.local` n'est **pas chiffré** sur disque. `chrome.storage.session` est en mémoire, effacé au redémarrage → jetons éphémères. Pour des secrets durables (clés API) : ressaisie par session, ou native messaging vers le trousseau de l'OS.
