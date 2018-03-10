Rails.application.routes.draw do
  namespace :admin do
    resources :sources do
      collection do
        post "/switch-to", to: "sources#switch_to"
      end
    end

    resources :attributions do
      collection do
        post "/assign", to: "attributions#assign"
      end
    end

    resources :inclusions

    resources :composers do
      collection do
        post "/switch-to", to: "composers#switch_to"
      end
    end

    resources :unique_pieces, only: [:create, :update]

    get "/auth", to: "authentication#index", as: "authentication"
    post "/auth/authenticate", to: "authentication#authenticate", as: "authenticate"
    post "/auth/logout", to: "authentication#logout", as: "logout"

    resources :groups, only: [:index] do
      collection do
        post :merge
      end
    end

    root to: "home#index"
  end

  resources :inclusions, only: [:index]

  root to: "inclusions#index"
end
