module Admin
  class AttributionsController < AdminControllerBase
    def index

    end

    def assign
      params[:attributions].each do |attribution|
        next if attribution[:id].blank?

        composer = Composer.find(params[:composer_id])

        if attribution[:id] == "on"
          attrib = Attribution.new(inclusion_id: attribution[:inclusion_id])
          incorrectly_attributed = true
        else
          attrib = Attribution.find(attribution[:id])
          incorrectly_attributed = params[:incorrectly_attributed]
        end

        success = true

        if incorrectly_attributed
          success = attrib.update_attributes(
            alias: nil,
            composer: composer,
            incorrectly_attributed: true,
          )
        else
          composer_alias = Alias.find_or_create_by!(
            composer: composer,
            anonym: attrib.anonym,
          )

          success = composer_alias.persisted?

          success = attrib.update_attributes(
            anonym: nil,
            alias: composer_alias,
            composer: nil,
            incorrectly_attributed: false,
          )
        end

        unless success
          flash[:error] = (attrib.errors.full_messages + composer_alias.errors.full_messages).to_sentence
        end
      end

      redirect_to admin_attributions_path
    end
  end
end
