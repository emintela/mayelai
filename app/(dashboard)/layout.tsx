import Navbar from '../../components/navbar';
import Sidebar from '../../components/sidebar';

const DashboardLayout = ({
    children
  }: {
    children: React.ReactNode;
  }) => {
    return (
      <div className="h-full relative">
        {/* Sidebar */}
        <div
          className="hidden h-full md:flex md:w-72
            md:flex-col md:fixed md:inset-y-0 z-[80]
            bg-gray-900"
        >
          <Sidebar/>
        </div>
  
        
        <main className="md:pl-72">
          <Navbar/>
          {children} {/* ✅ Render the page content here */}
        </main>
      </div>
    );
  };
  
  export default DashboardLayout;
  