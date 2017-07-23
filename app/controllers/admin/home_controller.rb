module Admin
  class HomeController < AdminControllerBase
    def index
      redirect_to admin_sources_path
    end
  end
end
