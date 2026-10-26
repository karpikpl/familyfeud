import { parse } from "csv-parse/sync";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { Question } from "./types";

interface Row {
  question: string;
  answer: string;
  points: string;
}

export function loadQuestions(path: string, strict = false): Question[] {
  if (!existsSync(path)) {
    if (strict) throw new Error("The selected CSV file no longer exists.");
    console.warn(`[csv] no questions file at ${path} — starting empty`);
    return [];
  }
  const raw = readFileSync(path, "utf8");
  const rows = parse(raw, {
    columns: (header: string[]) => {
      const columns = header.map((h) => h.trim().toLowerCase());
      if (strict && ["question", "answer", "points"].some((name) => !columns.includes(name))) {
        throw new Error("CSV must have question, answer, and points columns.");
      }
      return columns;
    },
    skip_empty_lines: true,
    trim: true,
  }) as Row[];

  const byQuestion = new Map<string, Question>();
  let nextId = 1;
  for (const row of rows) {
    const qText = (row.question ?? "").trim();
    const aText = (row.answer ?? "").trim();
    const pts = Number((row.points ?? "0").trim());
    if (strict && (!qText || !aText || !row.points?.trim() || !Number.isInteger(pts) || pts < 0)) {
      throw new Error("Every CSV row needs a question, an answer, and non-negative whole-number points.");
    }
    if (!qText || !aText) continue;

    let q = byQuestion.get(qText);
    if (!q) {
      q = { id: nextId++, text: qText, answers: [] };
      byQuestion.set(qText, q);
    }

    q.answers.push({ text: aText, points: Number.isFinite(pts) ? pts : 0, revealed: false });
  }

  // Family Feud: highest-point answers on top.
  for (const q of byQuestion.values()) {
    q.answers.sort((a, b) => b.points - a.points);
  }

  return Array.from(byQuestion.values());
}

export function listQuestionFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .sort();
}

export function loadQuestionFile(root: string, filename: string): Question[] {
  if (!listQuestionFiles(root).includes(filename)) throw new Error("Select a CSV file from the server's list.");
  const questions = loadQuestions(join(root, filename), true);
  if (!questions.length) throw new Error("The selected CSV contains no questions.");
  return questions;
}
