import React from 'react';

export const KanbanTab = React.memo(function KanbanTab({ tasks }) {
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const columns = [
    { key: 'todo', title: 'To Do', items: todoTasks },
    { key: 'in_progress', title: 'In Progress', items: inProgressTasks },
    { key: 'done', title: 'Done', items: doneTasks },
  ];

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {columns.map((col) => (
          <div key={col.key} className="bg-[#0b132b] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-semibold capitalize font-mono text-slate-100">{col.title}</h3>
              <span className="text-xs font-mono text-slate-500 tabular-nums">{col.items.length}</span>
            </div>
            {col.items.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">No tasks</div>
            ) : (
              col.items.map((task) => (
                <div key={task.id} className="p-3 bg-slate-900 border border-slate-800 rounded space-y-1.5">
                  <div className="text-xs font-semibold text-slate-200">{task.title}</div>
                  <div className="text-[11px] font-mono text-amber-300/90">{task.markdown_file_path}</div>
                  {task.commits && task.commits.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
                      Linked: {task.commits[0].commit_sha.slice(0, 8)} ({task.commits[0].action_type})
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </section>
  );
});
