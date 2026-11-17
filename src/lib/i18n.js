import { useCallback, useSyncExternalStore } from "react";

// Tiny i18n for the Money module: English and French (Lingala coming soon).
// The choice is remembered per browser.
const KEY = "mayelai.lang";
const listeners = new Set();

function read() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "fr") return v;
  } catch {
    /* storage blocked */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current = read();

export function setLang(lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useLang() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
}

const dict = {
  en: {
    money: "Money",
    moneyTagline: "Track money you lent or borrowed — kindly.",
    owedToYou: "Owed to you",
    youOwe: "You owe",
    overdue: "overdue",
    nothingYet: "Nothing here yet",
    nothingYetBody: "Record money you lent or borrowed. Mayel'AI keeps track and helps with polite reminders.",
    quickAdd: "Tell me in one sentence",
    quickAddPlaceholder: "e.g. I lent Patrick $200, he'll pay back on the 30th",
    understand: "Fill the form",
    addManually: "Add manually",
    open: "Open",
    closed: "Closed",
    lentTo: "You lent",
    borrowedFrom: "You borrowed",
    left: "left",
    of: "of",
    dueToday: "Due today",
    dueIn: "Due in {n} days",
    dueTomorrow: "Due tomorrow",
    lateBy: "{n} days late",
    noDueDate: "No due date",
    confirmed: "Confirmed",
    waiting: "Not confirmed yet",
    disputed: "Disputed",
    remindedOn: "Reminded {date}",
    statusPaid: "Paid",
    statusForgiven: "Forgiven",
    statusCancelled: "Cancelled",
    freeUsage: "{n} of {max} free open loans used.",
    upgrade: "Upgrade to Pro",
    newLoan: "New loan",
    iLent: "I lent money",
    iBorrowed: "I borrowed money",
    theirName: "Their name",
    theirPhone: "Their phone (optional, for WhatsApp)",
    amount: "Amount",
    currency: "Currency",
    dateLent: "Date",
    dueDate: "Pay back by (optional)",
    note: "Note (optional)",
    notePlaceholder: "e.g. rent, school fees",
    reminderLanguage: "Reminder language",
    lingalaSoon: "Lingala — coming soon",
    yourName: "Your name (shown to them)",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    aiFilled: "Filled in by the assistant — please check before saving.",
    original: "Lent",
    paid: "Paid back",
    outstanding: "Still owed",
    shareTitle: "Ask {name} to confirm",
    shareBody: "Send this link so {name} can confirm the loan in one tap — no account needed.",
    shareMessage:
      "Hi {name}, I noted the {amount} I lent you on Mayel'AI so we both keep track. Can you confirm here? {link}",
    shareMessageBorrowed:
      "Hi {name}, I noted the {amount} you lent me on Mayel'AI so we both keep track. Can you confirm here? {link}",
    whatsapp: "WhatsApp",
    sms: "SMS",
    copy: "Copy",
    copied: "Copied!",
    newLink: "New link",
    newLinkConfirm: "Create a new link? The old one will stop working and the confirmation resets.",
    reminder: "Send a reminder",
    reminderBody: "Mayel'AI writes a kind message; you check it and send it from your own WhatsApp or SMS.",
    tone: "Tone",
    gentle: "Gentle",
    firm: "Firm but polite",
    writeWithAi: "Write it for me",
    writing: "Writing…",
    reminderHistory: "Reminders sent",
    recordPayment: "Record a payment",
    method: "How",
    paidOn: "Date",
    add: "Add",
    payments: "Payments",
    noPayments: "No payments yet.",
    remove: "Remove",
    markPaid: "Mark fully paid",
    forgive: "Forgive",
    cancelLoan: "Cancel loan",
    reopen: "Reopen",
    deleteLoan: "Delete",
    deleteConfirm: "Delete this loan and its history? This can't be undone.",
    theyConfirmed: "{name} confirmed this loan.",
    theyDisputed: "{name} says this isn't right.",
    theyHaventConfirmed: "{name} hasn't confirmed yet.",
    edit: "Edit",
    back: "Back",
    noMoneyHandled: "Mayel'AI never holds or sends money. Payments happen the way you already pay each other.",
    // public page
    pubLent: "{owner} noted that they lent you {amount} on {date}.",
    pubBorrowed: "{owner} noted that they borrowed {amount} from you on {date}.",
    pubStill: "Still owed: {amount}",
    pubDue: "To pay back by {date}.",
    pubConfirmQ: "Is this right?",
    pubYes: "Yes, that's right",
    pubNo: "That's not right",
    pubNote: "Add a message (optional)",
    pubThanksYes: "Thank you! {owner} can see that you confirmed.",
    pubThanksNo: "Thanks — {owner} will see that you disagree. Talk it through together.",
    pubClosed: "This loan is closed.",
    pubNotFound: "This link doesn't work anymore. Ask for a new one.",
    pubChange: "Change my answer",
    pubFooter: "Mayel'AI doesn't handle money. Pay back the way you usually do.",
  },
  fr: {
    money: "Argent",
    moneyTagline: "Suivez l'argent prêté ou emprunté — avec douceur.",
    owedToYou: "On vous doit",
    youOwe: "Vous devez",
    overdue: "en retard",
    nothingYet: "Rien pour l'instant",
    nothingYetBody: "Notez l'argent prêté ou emprunté. Mayel'AI en garde la trace et aide à faire des rappels polis.",
    quickAdd: "Dites-le en une phrase",
    quickAddPlaceholder: "ex. J'ai prêté 200 $ à Patrick, il rembourse le 30",
    understand: "Remplir le formulaire",
    addManually: "Ajouter à la main",
    open: "En cours",
    closed: "Terminés",
    lentTo: "Vous avez prêté",
    borrowedFrom: "Vous avez emprunté",
    left: "restant",
    of: "sur",
    dueToday: "À rembourser aujourd'hui",
    dueIn: "Dans {n} jours",
    dueTomorrow: "Demain",
    lateBy: "{n} jours de retard",
    noDueDate: "Pas de date",
    confirmed: "Confirmé",
    waiting: "Pas encore confirmé",
    disputed: "Contesté",
    remindedOn: "Rappel le {date}",
    statusPaid: "Remboursé",
    statusForgiven: "Pardonné",
    statusCancelled: "Annulé",
    freeUsage: "{n} sur {max} prêts gratuits en cours.",
    upgrade: "Passer à Pro",
    newLoan: "Nouveau prêt",
    iLent: "J'ai prêté",
    iBorrowed: "J'ai emprunté",
    theirName: "Son nom",
    theirPhone: "Son téléphone (facultatif, pour WhatsApp)",
    amount: "Montant",
    currency: "Devise",
    dateLent: "Date",
    dueDate: "À rembourser avant (facultatif)",
    note: "Note (facultatif)",
    notePlaceholder: "ex. loyer, frais scolaires",
    reminderLanguage: "Langue des rappels",
    lingalaSoon: "Lingala — bientôt",
    yourName: "Votre nom (visible par la personne)",
    save: "Enregistrer",
    saving: "Enregistrement…",
    cancel: "Annuler",
    aiFilled: "Rempli par l'assistant — vérifiez avant d'enregistrer.",
    original: "Prêté",
    paid: "Remboursé",
    outstanding: "Reste dû",
    shareTitle: "Demander à {name} de confirmer",
    shareBody: "Envoyez ce lien pour que {name} confirme le prêt en un clic — sans compte.",
    shareMessage:
      "Salut {name}, j'ai noté les {amount} que je t'ai prêtés sur Mayel'AI pour qu'on garde une trace tous les deux. Tu peux confirmer ici ? {link}",
    shareMessageBorrowed:
      "Salut {name}, j'ai noté les {amount} que tu m'as prêtés sur Mayel'AI pour qu'on garde une trace tous les deux. Tu peux confirmer ici ? {link}",
    whatsapp: "WhatsApp",
    sms: "SMS",
    copy: "Copier",
    copied: "Copié !",
    newLink: "Nouveau lien",
    newLinkConfirm: "Créer un nouveau lien ? L'ancien ne marchera plus et la confirmation sera remise à zéro.",
    reminder: "Envoyer un rappel",
    reminderBody: "Mayel'AI écrit un message aimable ; vous le relisez et l'envoyez depuis votre WhatsApp ou SMS.",
    tone: "Ton",
    gentle: "Doux",
    firm: "Ferme mais poli",
    writeWithAi: "Écris-le pour moi",
    writing: "Rédaction…",
    reminderHistory: "Rappels envoyés",
    recordPayment: "Noter un remboursement",
    method: "Moyen",
    paidOn: "Date",
    add: "Ajouter",
    payments: "Remboursements",
    noPayments: "Aucun remboursement pour l'instant.",
    remove: "Supprimer",
    markPaid: "Marquer comme remboursé",
    forgive: "Pardonner la dette",
    cancelLoan: "Annuler le prêt",
    reopen: "Rouvrir",
    deleteLoan: "Supprimer",
    deleteConfirm: "Supprimer ce prêt et son historique ? C'est définitif.",
    theyConfirmed: "{name} a confirmé ce prêt.",
    theyDisputed: "{name} dit que ce n'est pas correct.",
    theyHaventConfirmed: "{name} n'a pas encore confirmé.",
    edit: "Modifier",
    back: "Retour",
    noMoneyHandled: "Mayel'AI ne garde ni n'envoie jamais d'argent. Vous payez comme d'habitude.",
    pubLent: "{owner} a noté vous avoir prêté {amount} le {date}.",
    pubBorrowed: "{owner} a noté vous avoir emprunté {amount} le {date}.",
    pubStill: "Reste dû : {amount}",
    pubDue: "À rembourser avant le {date}.",
    pubConfirmQ: "Est-ce correct ?",
    pubYes: "Oui, c'est correct",
    pubNo: "Ce n'est pas correct",
    pubNote: "Ajouter un message (facultatif)",
    pubThanksYes: "Merci ! {owner} voit que vous avez confirmé.",
    pubThanksNo: "Merci — {owner} verra que vous n'êtes pas d'accord. Parlez-en ensemble.",
    pubClosed: "Ce prêt est clôturé.",
    pubNotFound: "Ce lien ne marche plus. Demandez-en un nouveau.",
    pubChange: "Changer ma réponse",
    pubFooter: "Mayel'AI ne gère pas l'argent. Remboursez comme d'habitude.",
  },
};

export function useT() {
  const lang = useLang();
  return useCallback(
    (key, vars = {}) => {
      let s = dict[lang][key] ?? dict.en[key] ?? key;
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
      return s;
    },
    [lang]
  );
}
