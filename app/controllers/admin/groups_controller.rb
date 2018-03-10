module Admin
  class GroupsController < ApplicationController
    def index
      @unique_pieces = UniquePiece.limit(10)
    end

    def merge
      redirect_to admin_groups_path
    end
  end
end
