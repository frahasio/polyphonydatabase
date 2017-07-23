module Admin
  class AdminControllerBase < ApplicationController
    before_action :check_authentication
    layout "admin"

  private

    def admin?
      true
    end
    helper_method :admin?

    def check_authentication
      redirect_to admin_authentication_path unless logged_in?
    end

    def logged_in?
      current_user.present?
    end
    helper_method :logged_in?

    def current_user
      @current_user ||= User.find_by(id: session[:user_id])
    end
    helper_method :current_user
  end
end
