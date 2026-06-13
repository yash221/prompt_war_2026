/*
 * MindEase offline knowledge base.
 * Powers the deterministic fallback engine so the app gives a real,
 * useful reflection even with no API key / no network.
 *
 * TRIGGER_RULES: if any keyword appears in the journal, we surface that
 * trigger and pull in its coping strategies. Ordered loosely by theme.
 */
const TRIGGER_RULES = [
  {
    match: ["syllabus", "behind", "backlog", "so much to", "too much to", "incomplete", "not done", "pending", "cover everything"],
    label: "Feeling behind on the syllabus",
    category: "academic",
    strategies: [
      { title: "Shrink the mountain", detail: "List only the next 3 topics, not the whole syllabus. Finish one before looking at the rest." },
      { title: "Time-box it", detail: "Set a 25-minute timer for one topic. Starting is the hard part; momentum follows." },
    ],
  },
  {
    match: ["mock", "test score", "marks", "rank", "percentile", "low score", "failed", "failing", "result", "cutoff"],
    label: "Tying your worth to test scores",
    category: "performance",
    strategies: [
      { title: "Score as data, not a verdict", detail: "A mock shows what to revise next, not who you are. Note the 2 weakest topics and move on." },
      { title: "Track effort, not just outcome", detail: "Log hours studied and topics revised. These are in your control; the rank is not." },
    ],
  },
  {
    match: ["compare", "comparison", "everyone else", "others are", "friends are", "topper", "better than me", "ahead of me"],
    label: "Comparing yourself to others",
    category: "social",
    strategies: [
      { title: "Mute the leaderboard", detail: "Step back from rank-talk groups for a day. Comparison steals focus you need for your own prep." },
      { title: "Run your own race", detail: "Write down one thing you did better this week than last week. That's the only comparison that helps." },
    ],
  },
  {
    match: ["parents", "family", "father", "mother", "dad", "mom", "expectations", "disappoint", "let them down", "pressure from"],
    label: "Weight of family expectations",
    category: "family",
    strategies: [
      { title: "Name the fear out loud", detail: "Tell one trusted person 'I'm scared of disappointing everyone.' Said out loud, it loosens its grip." },
      { title: "Separate their hope from your worth", detail: "Their expectations are about love and worry, not a measure of your value as a person." },
    ],
  },
  {
    match: ["sleep", "can't sleep", "cant sleep", "insomnia", "awake", "tired", "exhausted", "no energy", "drained", "fatigue"],
    label: "Poor sleep and low energy",
    category: "physical",
    strategies: [
      { title: "Protect a wind-down", detail: "Screens off 30 minutes before bed. Even 20 extra minutes of sleep sharpens recall the next day." },
      { title: "Study with the body, not against it", detail: "When energy crashes, take a 10-minute walk instead of forcing focus. It resets attention faster than caffeine." },
    ],
  },
  {
    match: ["time", "not enough time", "running out", "deadline", "too late", "days left", "no time"],
    label: "Time pressure as the exam nears",
    category: "academic",
    strategies: [
      { title: "Triage by weightage", detail: "Spend the limited time on high-weightage, high-confidence topics first. Maximum return for the hours you have." },
      { title: "One day at a time", detail: "You can't study the whole month today. Plan only tomorrow tonight, then close the books." },
    ],
  },
  {
    match: ["focus", "distracted", "concentrate", "phone", "procrastinat", "can't study", "cant study", "wasting time", "scrolling"],
    label: "Trouble focusing",
    category: "academic",
    strategies: [
      { title: "Park the phone elsewhere", detail: "Leave it in another room for one study block. Out of reach beats relying on willpower." },
      { title: "Two-minute start", detail: "Promise yourself just two minutes on a topic. Most of the time you'll keep going once you begin." },
    ],
  },
  {
    match: ["anxious", "anxiety", "panic", "nervous", "scared", "fear", "worried", "dread", "overwhelm", "stress", "stressed"],
    label: "Anxiety and overwhelm",
    category: "emotional",
    strategies: [
      { title: "Ground in the present", detail: "Name 5 things you can see and 3 you can hear. Anxiety lives in the future; this pulls you back to now." },
      { title: "Worry on paper", detail: "Write the exact worry in one line. Seeing it written shrinks it from a fog into a single, smaller thing." },
    ],
  },
  {
    match: ["alone", "lonely", "isolated", "no one understands", "nobody", "by myself"],
    label: "Feeling alone in this",
    category: "social",
    strategies: [
      { title: "Reach out once", detail: "Message one friend or sibling today, even just to say hi. Connection lightens the load more than we expect." },
      { title: "You're not the only one", detail: "Almost every aspirant around you feels this too, even the ones who look calm. You're in good company." },
    ],
  },
  {
    match: ["future", "career", "life ruined", "no future", "worthless", "useless", "give up", "pointless", "what's the point", "hopeless"],
    label: "Fear about your future",
    category: "emotional",
    strategies: [
      { title: "Widen the lens", detail: "This one exam is a door, not the only door. Many paths reopen later; your worth isn't decided by a single result." },
      { title: "Back to today's one step", detail: "The future feels huge because it's far. The only move you control is the next hour. Make it a kind one." },
    ],
  },
];

// General strategies used when no specific trigger is detected.
const GENERAL_STRATEGIES = [
  { title: "One next step", detail: "Pick the single smallest study task and do only that. Clarity comes from motion, not from planning." },
  { title: "Move your body", detail: "Take a 10-minute walk or stretch. It clears stress hormones and resets your focus." },
  { title: "Be your own friend", detail: "Talk to yourself the way you'd talk to a stressed friend, with patience, not criticism." },
];

/*
 * Mindfulness exercises, chosen by current mood.
 * low mood -> calming; mid -> grounding; good -> a quick reset to sustain it.
 */
const MINDFULNESS = {
  low: {
    name: "4-7-8 Calming Breath",
    duration: "3 min",
    steps: [
      "Sit comfortably and rest one hand on your belly.",
      "Breathe in quietly through your nose for 4 counts.",
      "Hold your breath gently for 7 counts.",
      "Breathe out slowly through your mouth for 8 counts.",
      "Repeat 4 rounds. Notice your shoulders soften.",
    ],
  },
  mid: {
    name: "5-4-3-2-1 Grounding",
    duration: "2 min",
    steps: [
      "Name 5 things you can see around you.",
      "Notice 4 things you can physically feel.",
      "Listen for 3 things you can hear.",
      "Find 2 things you can smell.",
      "Take 1 slow breath and notice you are here, safe, right now.",
    ],
  },
  good: {
    name: "Box Breathing Reset",
    duration: "2 min",
    steps: [
      "Breathe in through your nose for 4 counts.",
      "Hold for 4 counts.",
      "Breathe out for 4 counts.",
      "Hold empty for 4 counts.",
      "Repeat 4 rounds to lock in a calm, focused state.",
    ],
  },
};

// Warm, exam-aware encouragements, chosen by wellness state.
const ENCOURAGEMENTS = {
  over: [
    "Today is heavy, and the fact that you still showed up to write this says a lot about your strength. You don't have to fix everything tonight, just be a little kind to yourself.",
    "Right now the pressure feels enormous, but feelings are not forecasts. You've survived every hard day so far. Let today be about resting, not proving anything.",
  ],
  warn: [
    "You're stretched thin, and that's a signal to slow down, not push harder. Do one small thing well, then let yourself rest. Steady beats frantic every time.",
    "Stress this high usually means you care deeply, which is also the thing that will carry you. Ease off the throttle for an hour; the syllabus will still be there.",
  ],
  ok: [
    "You're finding your rhythm, and that consistency matters more than any single brilliant day. Keep protecting what's working and trust the process.",
    "You're doing better than your inner critic admits. Keep going at this pace, take your breaks, and let the small wins add up.",
  ],
};

/*
 * Crisis detection, mirrored from the backend so offline mode is also safe.
 * If matched, the UI surfaces verified India helplines.
 */
const CRISIS_RE = new RegExp(
  [
    "kill (myself|me)", "end (my|this) life", "want to die", "wanna die", "suicid",
    "self[\\s-]?harm", "hurt(ing)? myself", "cut(ting)? myself", "no reason to live",
    "don'?t want to live", "can'?t go on", "end it all", "better off dead",
    "no point (in )?living", "take my (own )?life", "give up on life",
  ].join("|"),
  "i"
);

const HELPLINES = [
  { name: "Tele-MANAS (Govt. of India)", contact: "14416 / 1-800-891-4416", note: "24x7 mental health support" },
  { name: "iCall (TISS)", contact: "9152987821", note: "Mon-Sat, 8am-10pm, counselling" },
  { name: "AASRA", contact: "9820466726", note: "24x7 suicide prevention" },
  { name: "Vandrevala Foundation", contact: "1860-2662-345", note: "24x7 free counselling" },
];

const CRISIS_MESSAGE =
  "It sounds like you're carrying something really heavy right now, and you don't have to " +
  "carry it alone. Please reach out to someone who can support you right away. You matter " +
  "far more than any exam.";
