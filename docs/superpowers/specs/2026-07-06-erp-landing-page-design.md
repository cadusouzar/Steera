# Nexus ERP - Frontend Design Spec
Date: 2026-07-06
Topic: Landing Page & Frontend Foundation

## 1. Context & Purpose
The goal is to build a premium, high-tech landing page and frontend foundation for a comprehensive B2B SaaS ERP and HR system. The initial implementation will cover the landing page, pricing plans, a login gateway, and the foundational architecture.

## 2. Visual Direction: "A Rede Conectada"
The user has selected Option A, which focuses on a premium, high-tech aesthetic.

**Core Aesthetics:**
- **Theme:** Dark Mode by default.
- **Style:** Glassmorphism (translucent panels, background blurs), layered UI, deep space/ambient lighting.
- **Signature Element:** A Three.js 3D abstract network (particles connected by lines) acting as an interactive, slow-moving background in the Hero section. It symbolizes connectivity between HR, Data, and Logistics.

**Tokens & Palette (Draft):**
- **Background:** Deep Slate (`#0F172A`) to Midnight Blue (`#020617`).
- **Primary Accent:** Electric Blue (`#3B82F6`) and Indigo (`#6366F1`) for glows and key actions.
- **Typography:** `Outfit` for headings (modern, geometric, tech) and `Inter` for body copy (highly legible UI font).
- **Surfaces:** Frosted glass panels using Tailwind's `bg-white/5 backdrop-blur-lg border border-white/10`.

## 3. Architecture & Tech Stack
- **Framework:** React + TypeScript.
- **Build Tool:** Vite (optimized for Single Page Applications, ideal for ERP dashboards).
- **Styling:** TailwindCSS for utility classes and rapid design system implementation.
- **Animations:** `@react-three/fiber` and `@react-three/drei` for the 3D canvas, `framer-motion` for UI micro-interactions and scroll reveals.
- **Routing:** `react-router-dom`.

## 4. Components & Structure
1. **Hero Section:** Bold headline, subheadline, CTA to view plans, backed by the interactive 3D network canvas.
2. **Value Proposition / Features:** Clean grid showing the core modules (HR, ERP/Logistics, Finance, BI) using Lucide-react icons and subtle hover animations.
3. **Pricing Plans:** 3-tier glassmorphism cards. The "Pro" tier will be highlighted with a glowing border.
4. **Login Gateway:** Accessible via the navbar or after selecting a plan. A sleek modal or page with form validation.

## 5. Performance & UX Rules
- The Three.js canvas must not block the main thread; use `dpr={[1, 2]}` to optimize pixel ratio for performance.
- Respect `prefers-reduced-motion` for both UI animations and the 3D canvas.
- Ensure all text on top of glassmorphism panels has a minimum contrast ratio of 4.5:1.
