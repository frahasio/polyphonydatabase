Rails.application.routes.draw do
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

  root to: "home#index"
end
