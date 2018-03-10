module Admin
  class GroupsController < ApplicationController
    def index
      @unique_pieces = UniquePiece.limit(10)
    end
  end
end
