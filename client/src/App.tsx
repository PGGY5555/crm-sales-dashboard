import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Trends from "./pages/Trends";
import Funnel from "./pages/Funnel";
import Customers from "./pages/Customers";
import AIChat from "./pages/AIChat";
import Sync from "./pages/Sync";
import CustomerManagement from "./pages/CustomerManagement";
import OrderManagement from "./pages/OrderManagement";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/trends"} component={Trends} />
        <Route path={"/funnel"} component={Funnel} />
        <Route path={"/customers"} component={Customers} />
        <Route path={"/ai-chat"} component={AIChat} />
        <Route path={"/sync"} component={Sync} />
        <Route path={"/customer-management"} component={CustomerManagement} />
        <Route path={"/order-management"} component={OrderManagement} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
