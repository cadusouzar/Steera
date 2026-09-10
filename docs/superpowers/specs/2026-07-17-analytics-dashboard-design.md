# Analytics Dashboard (Self-Service BI) Design Spec

## Context
The goal is to build an intuitive, zero-code analytics module focused on self-service BI for non-technical users. It needs to hide database complexity behind business terms and provide instant visual feedback.

## Architecture & UX Decisions

### 1. Dashboard Hub (UX)
- Users will land on a "Meus Dashboards" gallery page.
- Dashboards are presented as cards with metadata (Title, Last Modified).
- From here, they can open an existing dashboard or create a new one.

### 2. State Management & Storage (Architecture)
- We will NOT use a relational structure for every widget and filter.
- Instead, the entire dashboard layout and configuration will be serialized into a single **JSON object**.
- This JSON schema allows for maximum flexibility in the frontend without requiring database migrations for every new visual feature.

**Sample Schema:**
```json
{
  "layout": "grid",
  "widgets": [
    {
      "id": "123",
      "type": "kpi-card",
      "position": { "x": 0, "y": 0, "w": 2, "h": 1 },
      "data": { "metric": "total_sales" }
    }
  ]
}
```

### 3. Core Components
- **Data Panel (Left):** Displays business entities (e.g., "Vendas", "Clientes") as draggable pills.
- **Canvas (Center):** A magnetic grid (snap-to-grid) that accepts dragged pills.
- **Visual Props (Right):** Context-aware properties panel that appears when a widget is selected.
- **Auto-Charting:** Dropping a metric creates a KPI. Dropping a dimension on a KPI converts it to a chart.

### 4. Next Steps for Implementation
1. Scaffold the Dashboard Hub UI.
2. Scaffold the Builder Workspace layout.
3. Implement a basic JSON state manager for the dashboard.
4. Implement drag-and-drop grid layout.
