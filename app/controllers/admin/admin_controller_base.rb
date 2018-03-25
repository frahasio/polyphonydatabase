module Admin
  class AdminControllerBase < ApplicationController
    before_action :check_authentication
    layout "admin"

  private

    def check_authentication
      redirect_to admin_authentication_path unless logged_in?
    end
  end
end
