#!/usr/bin/env bash
# Installe le service systemd user wingpen-broker.
# Idempotent — peut être relancé un nombre quelconque de fois sans danger :
# l'unité est TOUJOURS réécrite depuis le dépôt (jamais de "si elle existe
# déjà, on ne touche pas"), le daemon systemd est TOUJOURS rechargé, puis le
# script rapporte ce qui a changé. C'est ce qui empêche l'incident du
# 2026-09-21 (unité installée ayant dérivé du dépôt, silencieusement) de se
# reproduire par simple oubli de relancer ce script après un `git pull`.
#
# N'appelle jamais sudo, et n'appelle jamais `loginctl enable-linger` — les
# deux restent des décisions humaines, affichées en fin de script.
set -euo pipefail

# Refus root
if [ "$(id -u)" -eq 0 ]; then
  echo "Erreur : ce script ne doit pas être lancé en root (et n'appelle jamais sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UNIT_SRC="$PROJECT_ROOT/packaging/wingpen-broker.service"
SYSTEMD_DIR="$HOME/.config/systemd/user"
UNIT_DEST="$SYSTEMD_DIR/wingpen-broker.service"
PORT=8787

# Vérifications préalables
if [ ! -f "$UNIT_SRC" ]; then
  echo "Erreur : fichier unité introuvable : $UNIT_SRC" >&2
  exit 1
fi

# Création du dossier systemd utilisateur si nécessaire
if [ ! -d "$SYSTEMD_DIR" ]; then
  mkdir -p "$SYSTEMD_DIR"
  echo "Dossier créé : $SYSTEMD_DIR"
fi

# Toujours réécrire l'unité, même identique — c'est ce qui rend le script
# idempotent au sens fort : aucune divergence entre l'unité installée et
# packaging/wingpen-broker.service ne peut survivre à un second passage. On
# compare avant copie uniquement pour le rapport affiché plus bas.
UNIT_WAS_PRESENT=0
UNIT_CHANGED=1
if [ -f "$UNIT_DEST" ]; then
  UNIT_WAS_PRESENT=1
  if cmp -s "$UNIT_SRC" "$UNIT_DEST"; then
    UNIT_CHANGED=0
  fi
fi
cp "$UNIT_SRC" "$UNIT_DEST"

# Rechargement systématique du daemon utilisateur, même si le contenu n'a pas
# changé : un daemon-reload est sans effet de bord et coûte moins cher qu'un
# oubli qui laisserait systemd travailler sur une définition périmée.
systemctl --user daemon-reload

echo
echo "=== Rapport ==="
if [ "$UNIT_WAS_PRESENT" -eq 0 ]; then
  echo "Unité installée pour la première fois : $UNIT_DEST"
elif [ "$UNIT_CHANGED" -eq 1 ]; then
  echo "Unité mise à jour : $UNIT_DEST a changé (recopiée depuis $UNIT_SRC)."
else
  echo "Unité déjà à jour : $UNIT_DEST était déjà identique à $UNIT_SRC."
fi
echo "daemon-reload effectué."

# Activation au démarrage de session — idempotent nativement (systemctl ne se
# plaint pas si déjà activé), mais on distingue les deux cas dans le rapport.
if systemctl --user is-enabled wingpen-broker >/dev/null 2>&1; then
  echo "Service déjà activé (démarrage automatique à l'ouverture de session)."
else
  systemctl --user enable wingpen-broker
  echo "Service activé (démarrage automatique à l'ouverture de session)."
fi

# Démarrage (ou redémarrage si déjà actif) — reprend toujours la définition
# qu'on vient de recopier et recharger, jamais une version en mémoire.
systemctl --user restart wingpen-broker
echo "Service (re)démarré."

# Vérification : le broker répond-il sur 127.0.0.1:$PORT ?
echo "Vérification du broker sur 127.0.0.1:$PORT..."
MAX=10
i=0
while [ $i -lt $MAX ]; do
  if curl -sf --max-time 2 "http://127.0.0.1:$PORT/pair" -o /dev/null 2>/dev/null; then
    echo "Broker opérationnel sur http://127.0.0.1:$PORT/pair ✓"
    break
  fi
  sleep 1
  i=$((i + 1))
done

if [ $i -eq $MAX ]; then
  echo "Attention : le broker ne répond pas après ${MAX}s. Vérifier les logs :"
  echo "  journalctl --user -u wingpen-broker -n 30"
  exit 1
fi

echo
echo "Pour que le service démarre même sans session graphique ouverte (ex. après un"
echo "reboot sans connexion), il faut activer le \"linger\" systemd pour votre compte —"
echo "ce script ne le fait pas lui-même (réglage système partagé, décision humaine) :"
echo "  loginctl enable-linger $USER"
echo
echo "Installation terminée. Commandes utiles :"
echo "  systemctl --user status wingpen-broker"
echo "  journalctl --user -u wingpen-broker -f"
echo "  systemctl --user stop wingpen-broker"
echo "  systemctl --user disable wingpen-broker && rm $UNIT_DEST"
