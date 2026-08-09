import dayjs from 'dayjs';

const statusPriority = {
  ongoing: 1,
  due: 2,
  complete: 3,
};

export const transformProjectTimelineData = (timelineData) => {
  const sortedProjects = timelineData.sort(
    (a, b) => statusPriority[a.status] - statusPriority[b.status],
  );

  const groupedProjects = sortedProjects.reduce((acc, project) => {
    if (!acc[project.status]) {
      acc[project.status] = [];
    }
    acc[project.status].push(project);

    return acc;
  }, {});

  const transformedRows = sortedProjects.map((project) => {
    const group = groupedProjects[project.status];

    const isFirst = group[0].id === project.id;
    const isLast = group[group.length - 1].id === project.id;

    return {
      id: project.id,
      label: project.label,
      classes: [
        project.status,
        ...(isFirst ? ['task-divider-start'] : []),
        ...(isLast ? ['task-divider-end'] : []),
      ],
    };
  });

  const transformedTasks = sortedProjects.flatMap((project) => {
    return project.tasks.map((task) => ({
      ...task,
      id: task.id,
      from: task.startDate,
      to: task.endDate,
      resourceId: project.id,
      classes: [project.status],
    }));
  });

  return {
    rows: transformedRows,
    tasks: transformedTasks,
  };
};

export const getFromToDates = (tasks) => {
  const { earliestStartDate, latestEndDate } = tasks.reduce(
    (acc, task) => ({
      earliestStartDate: Math.min(acc.earliestStartDate, task.startDate),
      latestEndDate: Math.max(acc.latestEndDate, task.endDate),
    }),
    { earliestStartDate: tasks[0].startDate, latestEndDate: tasks[0].endDate },
  );

  return {
    from: dayjs(earliestStartDate).startOf('month').valueOf(),
    to: dayjs(latestEndDate).endOf('month').valueOf(),
  };
};

export const customDateAdapter = {
  format(date, format) {
    if (format === 'DD d') {
      const day = dayjs(date);
      const dayNumber = day.format('DD');
      const dayLetter = day.day();

      const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

      return `${dayNumber} ${dayLetters[dayLetter]}`;
    }

    return dayjs(date).format(format);
  },

  roundTo(date, unit, offset) {
    const manipulateUnit = unit;

    const roundedDate = dayjs(date)
      .startOf(unit)
      .add(offset - 15, manipulateUnit);

    return roundedDate.valueOf();
  },
};

export const generateTimeRanges = (from, to) => {
  const timeRanges = [];
  let current = dayjs(from).startOf('week');

  if (current.day() !== 0) {
    current = current.add(7 - current.day(), 'day');
  }

  let id = 1;

  while (current.valueOf() <= to) {
    const sundayStart = current.startOf('day').valueOf();
    const sundayEnd = current.endOf('day').valueOf();

    timeRanges.push({
      id: id++,
      from: sundayStart,
      to: sundayEnd,
      resizable: false,
    });

    current = current.add(7, 'day');
  }

  return timeRanges;
};
