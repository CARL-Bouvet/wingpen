# Installation du broker Wingpen

## Prérequis

- [Bun](https://bun.sh) installé (`~/.bun/bin/bun`)
- Une session utilisateur systemd active (loginctl show-session suffit)

## Installer le service systemd

```bash
bash scripts/install-service.sh
```

Le script :
1. Copie `packaging/wingpen-broker.service` dans `~/.config/systemd/user/`
2. Recharge le daemon (`systemctl --user daemon-reload`)
3. Active le service au démarrage de session (`systemctl --user enable wingpen-broker`)
4. Démarre le broker immédiatement
5. Vérifie que `http://127.0.0.1:8787/pair` répond

Le script est idempotent — relancer ne fait pas de mal.

## Vérifier l'état

```bash
systemctl --user status wingpen-broker
```

## Vérifier que toute la chaîne répond

```bash
bun scripts/probe-summarize.ts
```

Fait la poignée de main puis un `summarize` complet contre un faux transcript YouTube, sans ouvrir
de navigateur — sortie 0 si une réponse arrive, message de diagnostic en français sinon (poignée de
main refusée, `error`, timeout 150 s).

## Consulter les logs en direct

```bash
journalctl --user -u wingpen-broker -f
```

## Arrêter le broker

```bash
systemctl --user stop wingpen-broker
```

## Désinstaller

```bash
systemctl --user disable wingpen-broker
systemctl --user stop wingpen-broker
rm ~/.config/systemd/user/wingpen-broker.service
systemctl --user daemon-reload
```
