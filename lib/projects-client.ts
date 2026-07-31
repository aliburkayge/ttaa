"use client";

import type { JobBrand } from "./jobs";
import type { GeneratedArticle } from "./openai";
import type { ContentProject } from "./projects";

export class ProjectApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function json<T>(response: Response) {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) {
    const code = response.status === 401 ? "UNAUTHORIZED" : response.status === 409 ? "REVISION_CONFLICT" : "REQUEST_FAILED";
    throw new ProjectApiError(body.error || `Request failed (${response.status}).`, code, response.status);
  }
  return body;
}

export async function listProjects(brand: JobBrand) {
  const response = await fetch(`/api/projects?brand=${encodeURIComponent(brand)}`, { cache: "no-store" });
  const body = await json<{ projects: ContentProject[] }>(response);
  return body.projects;
}

export async function getProject(id: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { cache: "no-store" });
  const body = await json<{ project: ContentProject }>(response);
  return body.project;
}

export async function updateProjectArticle(id: string, revision: number, article: GeneratedArticle) {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, article }),
  });
  const body = await json<{ project: ContentProject }>(response);
  return body.project;
}

export async function syncProjectToWordPress(id: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/sync-wordpress`, { method: "POST" });
  const body = await json<{ project: ContentProject }>(response);
  return body.project;
}
