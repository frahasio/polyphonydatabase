Rails.application.routes.draw do
  namespace :admin do
    resources :compositions do
      member do
        get :confirm_delete
      end
    end

    resources :sources, except: [:new, :show, :destroy] do
      collection do
        post "/switch-to", to: "sources#switch_to"
      end
    end

    resources :inclusions, only: [:destroy]

    resources :composers do
      collection do
        post "/switch-to", to: "composers#switch_to"
      end
    end

    get "/auth", to: "authentication#index", as: "authentication"
    post "/auth/authenticate", to: "authentication#authenticate", as: "authenticate"
    post "/auth/logout", to: "authentication#logout", as: "logout"

    resources :groups, only: [:index] do
      collection do
        post :merge
      end

      member do
        get :confirm_remove
        post :remove
      end
    end

    resources :editions, only: [:index] do
      collection do
        patch :update_for_group
      end
    end

    resources :recordings, only: [:index] do
      collection do
        patch :update_for_group
      end
    end

    resources :editors, except: [:new, :show]
    resources :functions, except: [:new, :show]
    resources :performers, except: [:new, :show]
    resources :publishers, except: [:new, :show]
    resources :scribes, except: [:new, :show]
    resources :voicings, except: [:new, :show]

    resources :titles, only: [:index, :create] do
      collection do
        post :update_all
      end
    end

    resources :clef_combinations, path: "clef-combinations", only: [:index] do
      collection do
        post :match
      end
    end

    root to: "sources#index"
  end

  resources :groups, only: [:index]

  root to: "groups#index"
end
