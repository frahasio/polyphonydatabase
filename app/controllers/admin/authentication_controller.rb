module Admin
  class AuthenticationController < AdminControllerBase
    skip_before_action :check_authentication, only: [:index, :authenticate]

    def index; end

    def authenticate
      session[:user_id] = User.find_by(
        username: params[:username],
        password: params[:password],
      )&.id

      redirect_to admin_root_path
    end

    def logout
      session.delete(:user_id)

      redirect_to admin_authentication_path
    end
  end
end
