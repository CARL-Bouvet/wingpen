# Piloter un navigateur depuis Claude

Claude ne peut pas « voir » un navigateur déjà ouvert. Il s'y attache par le **protocole de
débogage Chrome** (CDP), qui doit être activé **au lancement** du navigateur — on ne peut pas
l'ouvrir après coup sur une fenêtre existante.

## Cas 1 — le navigateur de développement Wingpen (recommandé)

C'est celui qu'on utilise pour éprouver l'extension. Profil dédié, aucun rapport avec ton
navigateur quotidien.

```bash
cd ~/projets/wingpen
./scripts/start.sh                       # le broker, sur 127.0.0.1:8787

WINGPEN_CHROME=/usr/bin/brave \
WINGPEN_HEADLESS=0 \
WINGPEN_DEV=1 \
WINGPEN_TOKEN=$(cat ~/.local/share/wingpen/pairing.txt) \
./scripts/smoke.sh
```

Ce que ça fait : régénère la copie de dev de l'extension (permissions d'hôte accordées d'office),
lance Brave avec le profil `~/.local/share/wingpen/profile-brave`, charge l'extension, ouvre le
port de débogage **9222**, et sème le jeton de pairage dans `chrome.storage.session`.

Pour arrêter : `./scripts/smoke.sh --stop`

Une fois lancé, Claude s'y attache :

```bash
bun scripts/cdp-eval.js "chrome.runtime.id"                      # dans le service worker
bun scripts/cdp-eval.js "chrome.tabs.create({url:'https://…'})"  # ouvrir un onglet
```

`cdp-eval.js` cible le service worker de l'extension. Pour piloter une page ordinaire (cliquer,
remplir, capturer), passer par les MCP navigateur d'un worker Pyramid plutôt que par ce script.

## Cas 2 — ton Brave quotidien

**À ne faire que le temps d'un test, puis à refermer.** Le port de débogage donne un contrôle
total du navigateur : tous les onglets, toutes les sessions ouvertes — messagerie, banque,
comptes connectés — deviennent lisibles et pilotables par n'importe quel programme tournant sur
la machine. Il écoute sur `127.0.0.1`, donc rien ne vient du réseau, mais tout processus local y
accède sans authentification.

```bash
pkill brave            # Brave doit être ENTIÈREMENT fermé, sinon le flag est ignoré
                       # et la commande rouvre juste un onglet dans l'instance existante

brave --remote-debugging-port=9222 --remote-allow-origins='*' &
```

Vérifier que le port répond :

```bash
curl -s http://127.0.0.1:9222/json/version | head -3
```

Une réponse JSON avec la version de Brave = c'est bon. `Connection refused` = Brave n'était pas
complètement fermé au lancement.

Pour désactiver : fermer Brave et le rouvrir normalement, sans le flag. Rien ne persiste.

### Pourquoi `--remote-allow-origins`

Depuis Chrome 111, le navigateur rejette les connexions WebSocket au port de débogage qui portent
un en-tête `Origin` inattendu. Sans ce drapeau, l'attache échoue avec une erreur 403 difficile à
diagnostiquer.

## Vérifier à qui on est attaché

```bash
curl -s http://127.0.0.1:9222/json/list | python3 -c \
  "import json,sys; [print(t['type'],'—',t.get('title','')[:60]) for t in json.load(sys.stdin)]"
```

Liste les cibles : onglets, service workers, pages d'extension. Si tu y vois tes onglets
personnels, tu es sur le cas 2 — pense à refermer après.
