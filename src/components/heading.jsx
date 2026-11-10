import { cn } from "@/lib/utils";

const Heading = ({
  title,
  description,
  icon: Icon,
  iconColor,
  bgColor,
  className,
}) => {
  return (
    <div className={cn("mb-4 mt-4 flex items-center gap-x-3 px-4 sm:mb-8 lg:px-8", className)}>
      <div className={cn("w-fit rounded-md p-2", bgColor)}>
        <Icon className={cn("h-7 w-7 sm:h-10 sm:w-10", iconColor)} />
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-bold sm:text-3xl">{title}</h2>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{description}</p>
      </div>
    </div>
  );
};

export default Heading;
