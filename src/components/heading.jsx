import { cn } from "@/lib/utils";

// Page title: a soft icon tile, the title and a one-line description.
const Heading = ({ title, description, icon: Icon, iconColor, bgColor, className }) => {
  return (
    <div className={cn("mb-4 mt-4 flex min-w-0 items-center gap-x-3 px-4 sm:mb-8 sm:gap-x-4 lg:px-8", className)}>
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/15 sm:h-12 sm:w-12", bgColor, iconColor)}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl" style={{ fontFamily: "Montserrat, sans-serif" }}>
          {title}
        </h2>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{description}</p>
      </div>
    </div>
  );
};

export default Heading;
