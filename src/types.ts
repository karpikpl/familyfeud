export interface Answer {
  text: string;
  points: number;
  revealed: boolean;
}

export interface Question {
  id: number;
  text: string;
  answers: Answer[];
}

export interface Team {
  name: string;
  score: number;
}

export type Round =
  | { kind: "idle" }
  | {
      kind: "playing";
      questionId: number;
      pot: number;
      strikes: 0 | 1 | 2 | 3;
      strikeFlash: number; // increments to trigger client-side X flash
      buzzFlash: number;   // wrong-answer buzz that does NOT count as a strike (face-off)
      controllingTeam: 0 | 1 | null;
      // Once true, reveals/unreveals no longer change pot. Set when the pot is awarded.
      locked: boolean;
    };

export interface LastAward {
  team: 0 | 1;
  amount: number;
}

export interface AudioState {
  muted: boolean;
  themePlaying: boolean;
  themeVolume: number; // 0.0 – 1.0
}

export interface InstructionsState {
  visible: boolean;
  page: number; // 0-indexed
  total: number;
}

export type GameMode = "standard" | "fast_money";
export type FastMoneyPhase = "setup" | "asking" | "scoring" | "reveal" | "finished";
export type FastMoneyResult = "answer" | "pass" | "miss";

export interface FastMoneyAnswer {
  result: FastMoneyResult;
  text: string;
  points: number;
  answerIndex: number | null;
  recorded: boolean;
  revealed: boolean;
}

export type FastMoneyAnswerInput = Pick<FastMoneyAnswer, "text" | "points" | "answerIndex"> & {
  result?: FastMoneyResult;
};

export interface FastMoneyState {
  questionFile: string | null;
  playerSeconds: [number, number];
  questions: Question[];
  player: 0 | 1;
  phase: FastMoneyPhase;
  questionIndex: number;
  questionStatus: [
    ("unasked" | "answered" | "passed")[],
    ("unasked" | "answered" | "passed")[],
  ];
  answers: [FastMoneyAnswer[], FastMoneyAnswer[]];
  endsAt: number | null;
  buzzFlash: number;
}

export interface GameState {
  mode: GameMode;
  questionFile: string | null;
  fastMoney: FastMoneyState;
  gameOver: boolean;
  teams: [Team, Team];
  questions: Question[];
  currentQuestionIndex: number; // index into questions array; -1 if none
  round: Round;
  // UI hints
  reveal: {
    questionVisible: boolean;
  };
  audio: AudioState;
  instructions: InstructionsState;
  timer: { endsAt: number | null };
  // Most recent pot award. Set on award_pot, cleared on undo / endRound / question change.
  // Powers the "Undo last award" admin button.
  lastAward: LastAward | null;
}
